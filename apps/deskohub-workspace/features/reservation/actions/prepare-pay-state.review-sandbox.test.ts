import { seededReservationReads } from "@deskohub/dotypos/backend/service.mock";
import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { EmailRecipientDomainServiceMock } from "@deskohub/email/backend/recipient-domain.service.mock";
import { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option, Schema } from "effect";
import { ReservationAuthorDirectory } from "@/features/account";
import { customerAgentClientIdSchema } from "@/features/account/backend/auth/customer-agent-authorization.service";
import { makeOptionalAccountActivityGuard } from "@/features/account/backend/customer-account-activity.test-utils";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { AdministrationService } from "@/features/administration/administration.service";
import { PaymentAdministrationServiceMock } from "@/features/administration/payment-administration.service.mock";
import { PostHogReservationHistory } from "@/features/administration/posthog-reservation-history";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import { WorkspaceTableAssignmentServiceMock } from "@/features/checkout/backend/reservation/workspace-table-assignment.service.mock";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  discountAdvertisementQuoteCodec,
} from "@/features/discounts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { WithheldReferralService } from "@/features/referrals/referral.service.mock";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import {
  agentSelectionKeySchema,
  BookingAgent,
} from "@/features/reservation/backend/booking-agent";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { meetingRoomAdvertisedPriceReservationSchema } from "@/features/reservation/meeting-room-reservation";
import {
  getReviewPaymentDisabledPath,
  ReviewAccounts,
  ReviewSandbox,
} from "@/features/review-accounts";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import { CurrentPostHogRequestContext } from "@/shared/backend/analytics/posthog-request-context";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { PreparePayStateInput } from "./prepare-pay-state.schema";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));
const rememberedReferralCookie = {} satisfies { value?: string };

// The sandbox writes its own table, so the suite owns a database whose
// reservation ledger nothing else fills.
const database = await createWorkspacePostgresSuiteDatabase("review_sandbox");
afterAll(() => database?.close());

const meetingRoom = (reservationDate: string) => ({
  kind: "meeting-room" as const,
  duration: { unit: "hour" as const, amount: 4 as const },
  reservationDate,
  startsAt: `${reservationDate}T08:00:00Z`,
  endsAt: `${reservationDate}T12:00:00Z`,
  name: "App Review",
  email: testEmailAddress("app-review"),
  phone: "+44 20 7946 0123",
});

const advertisedPriceToken = async (reservationDate: string) => {
  const { buildAdvertisedPriceState, sealAdvertisedPriceState } = await import(
    "@/features/checkout/backend/checkout"
  );
  const advertised = Schema.decodeUnknownSync(
    meetingRoomAdvertisedPriceReservationSchema
  )({
    kind: "meeting-room",
    details: {
      kind: "meeting-room",
      duration: { unit: "hour", amount: 4 },
      reservationDate,
      lastServiceDate: reservationDate,
    },
  });
  const quote = Effect.runSync(
    getMeetingRoomReservationQuote(advertised.details)
  );
  return Effect.runPromise(
    buildAdvertisedPriceState({
      kind: "meeting-room",
      locale: "en-US",
      reservation: advertised,
      quote: {
        ...quote,
        fingerprint: getReservationQuoteFingerprint(advertised.details, quote),
      },
    }).pipe(Effect.flatMap(sealAdvertisedPriceState))
  );
};

const submission = async (
  reservationDate: string,
  ids: { readonly session: string; readonly attempt: string }
): Promise<PreparePayStateInput> => ({
  locale: "en-US",
  checkoutSessionId: ids.session as PreparePayStateInput["checkoutSessionId"],
  checkoutAttemptId: ids.attempt as PreparePayStateInput["checkoutAttemptId"],
  advertisedPriceToken: await advertisedPriceToken(reservationDate),
  marketingConsent: true,
  customer: "account",
  reservation: meetingRoom(reservationDate),
});

describe.skipIf(!database)(
  "prepareWorkspacePayState for a review account",
  () => {
    if (!database) return;

    const guard = makeOptionalAccountActivityGuard({
      session: {},
      activityState: "active",
    });
    const capture = mock(() => Effect.void);
    const unreachable = (name: string) =>
      mock(() => Effect.die(`${name} is outside the review sandbox`));

    // Every dependency a recorded booking reaches dies, so reaching one fails
    // the test: Dotypos, availability, the reservation ledger, hold cleanup,
    // marketing consent, and the profile contact.
    const contacts = Layer.mock(CustomerAccountContactService, {
      currentAccount: Effect.fail(
        new CustomerAccountAccessError({ reason: "unavailable" })
      ),
    });
    const services = Layer.mergeAll(
      guard.layer,
      Layer.mergeAll(ReviewAccounts.Default, ReviewSandbox.Default).pipe(
        Layer.provide(database.layer)
      ),
      CheckoutPricingService.Default.pipe(
        Layer.provide(
          DiscountServiceMock({
            discoverAdvertisedDiscounts: ({ discountableSubtotal, product }) =>
              Effect.succeed({
                quote: discountAdvertisementQuoteCodec.make({
                  product,
                  discountableSubtotal,
                  discounts: [],
                  totalDiscount: { ...discountableSubtotal, value: 0 },
                  discountedSubtotal: discountableSubtotal,
                }),
                complete: true,
              }),
            affirmAdvertisement: ({ product, discountableSubtotal }) =>
              Effect.succeed(
                affirmedDiscountAdvertisementQuoteCodec.make({
                  product,
                  discountableSubtotal,
                  discounts: [],
                  totalDiscount: { ...discountableSubtotal, value: 0 },
                  discountedSubtotal: discountableSubtotal,
                })
              ),
          })
        )
      ),
      Layer.mock(DotyposService, {
        findOrCreateCustomer: unreachable("Dotypos customer lookup"),
        createReservation: unreachable("Dotypos reservation"),
      }),
      Layer.mock(WorkspaceAvailabilityService, {
        ensureAvailable: unreachable("Availability check"),
        getAvailability: unreachable("Availability read"),
      }),
      Layer.mock(WorkspaceReservationRepository, {
        findByAttemptKeys: unreachable("Reservation ledger"),
        createDraft: unreachable("Reservation ledger"),
      }),
      Layer.mock(ReservationHoldCleanupScheduleService, {
        enqueueCleanup: unreachable("Hold cleanup"),
      }),
      Layer.mock(MarketingConsentLedger, {
        record: unreachable("Marketing consent"),
      }),
      // The profile contact fails as unavailable, so an ordinary account's
      // booking ends in a captured failure.
      contacts,
      WorkspaceTableAssignmentServiceMock({
        assignTableId: unreachable("Table assignment"),
      }),
      EmailRecipientDomainServiceMock({ check: unreachable("Email check") }),
      Layer.mock(OfficeReservationFeatureFlagService, {}),
      WithheldReferralService,
      RememberedReferral.inMemory(rememberedReferralCookie).pipe(
        Layer.provide(
          Layer.mergeAll(
            ReferralFeatureFlagService.fromDecision(false),
            WithheldReferralService,
            contacts
          )
        )
      ),
      Layer.mock(PostHogEventService, { capture })
    );

    // The account the activity guard fixture signs in.
    const accountId = customerAccountIdSchema.make(
      "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01"
    );
    beforeAll(() =>
      Effect.runPromise(
        workspaceFixtures(database.db).customerAccount({
          id: accountId,
          review: true,
        })
      )
    );
    const agent = (selection: string) =>
      Layer.succeed(BookingAgent, {
        clientId: customerAgentClientIdSchema.make("review-agent"),
        selectionKey: agentSelectionKeySchema.make(selection),
      });

    const prepare = async (
      input: PreparePayStateInput,
      bookingAgent?: Layer.Layer<BookingAgent>
    ) => {
      const { prepareWorkspacePayState } = await import("./prepare-pay-state");
      const operation = prepareWorkspacePayState(input).pipe(
        Effect.provide(services),
        // A consenting visitor, so every outcome the booking captures reaches
        // PostHog.
        Effect.provideService(CurrentPostHogRequestContext, {
          distinctId: PostHogDistinctId.make("review-visitor"),
        })
      );
      return Effect.runPromise(
        bookingAgent ? operation.pipe(Effect.provide(bookingAgent)) : operation
      );
    };

    const statusOf = (orderId: string) =>
      Effect.runPromise(
        ReviewSandbox.pipe(
          Effect.flatMap((sandbox) =>
            sandbox.status({
              orderId: orderId as never,
              returnOutcome: "unknown",
            })
          ),
          Effect.map(Option.getOrThrow),
          Effect.provide(
            ReviewSandbox.Default.pipe(Layer.provide(database.layer))
          )
        )
      );

    test("holds an agent's selection in the sandbox and links to the payment-disabled page", async () => {
      const input = await submission("2099-06-10", {
        session: "agent-session",
        attempt: "agent-attempt-a",
      });

      const first = await prepare(input, agent("selection-a"));
      const repeat = await prepare(input, agent("selection-a"));

      expect(first.status).toBe("ready");
      if (first.status !== "ready") return;
      expect(first.redirectUrl).toBe(
        getReviewPaymentDisabledPath("en-US", first.orderId)
      );
      expect(repeat).toEqual(first);
      expect((await statusOf(first.orderId)).status).toBe("created");
    });

    test("cancels the agent's open hold when it books a new selection", async () => {
      const previous = await prepare(
        await submission("2099-06-10", {
          session: "agent-session",
          attempt: "agent-attempt-a",
        }),
        agent("selection-a")
      );
      const next = await prepare(
        await submission("2099-06-11", {
          session: "agent-session",
          attempt: "agent-attempt-b",
        }),
        agent("selection-b")
      );

      if (previous.status !== "ready" || next.status !== "ready") {
        throw new Error("Expected ready sandbox holds");
      }
      expect(next.orderId).not.toBe(previous.orderId);
      expect((await statusOf(previous.orderId)).status).toBe("cancelled");
      expect((await statusOf(next.orderId)).status).toBe("created");
    });

    test("returns the website form's hold for a retried submission", async () => {
      const input = await submission("2099-06-12", {
        session: "site-session",
        attempt: "site-attempt",
      });

      const first = await prepare(input);
      const retry = await prepare(input);

      expect(retry).toEqual(first);
    });

    test("captures no checkout analytics for a booking or its failure", async () => {
      const input = await submission("2099-06-13", {
        session: "site-session-analytics",
        attempt: "site-attempt-analytics",
      });
      await prepare(input);
      const failed = await prepare({
        ...input,
        advertisedPriceToken: "not-a-price-token",
      }).then(
        () => "succeeded",
        () => "failed"
      );

      expect(failed).toBe("failed");
      expect(capture).not.toHaveBeenCalled();
    });

    test("still captures an ordinary account's outcome", async () => {
      const input = await submission("2099-06-14", {
        session: "site-session-ordinary",
        attempt: "site-attempt-ordinary",
      });
      await database.pool.query(
        "update customer_accounts set review = false where id = $1",
        [accountId]
      );
      // The ordinary path reads the profile contact, which fails here.
      await prepare(input).catch(() => undefined);
      await database.pool.query(
        "update customer_accounts set review = true where id = $1",
        [accountId]
      );

      expect(capture).toHaveBeenCalled();
      capture.mockClear();
    });

    test("leaves the reservation ledger and administration empty", async () => {
      const ledger = await database.pool.query<{ rows: string }>(
        `select (select count(*) from workspace_reservations)
            + (select count(*) from payment_attempts) as rows`
      );
      const listed = await Effect.runPromise(
        AdministrationService.pipe(
          Effect.flatMap((administration) =>
            administration.listReservations({})
          ),
          Effect.provide(
            AdministrationService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  database.layer,
                  DotyposServiceMock({
                    getCustomersByIds: () => Effect.succeed(new Map()),
                    getTables: () => Effect.succeed([]),
                    listReservations: () => Effect.succeed([]),
                    getReservationsByIds: (ids) =>
                      Effect.succeed([]).pipe(
                        Effect.flatMap((records) =>
                          seededReservationReads(records).getReservationsByIds(
                            ids
                          )
                        )
                      ),
                  }),
                  Layer.succeed(
                    PostHogReservationHistory,
                    PostHogReservationHistory.of({
                      load: () =>
                        Effect.succeed({ kind: "unavailable" } as const),
                    })
                  ),
                  PaymentAdministrationServiceMock({
                    loadReservationOrders: () => Effect.succeed([]),
                  }),
                  ReservationAuthorDirectory.Default.pipe(
                    Layer.provide(database.layer)
                  )
                )
              )
            )
          )
        )
      );

      expect(Number(ledger.rows[0]?.rows)).toBe(0);
      expect(listed.total).toBe(0);
    });
  }
);
