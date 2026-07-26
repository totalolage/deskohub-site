import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, setSystemTime, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import { CheckoutPricingServiceMock } from "@/features/checkout/backend/checkout/checkout-pricing.service.mock";
import type { LegalEvidenceEventRepository as LegalEvidenceEventRepositoryType } from "@/features/checkout/backend/repositories";
import type { WorkspaceCheckoutAccessCodeService as WorkspaceCheckoutAccessCodeServiceType } from "@/features/checkout/backend/reservation";
import { WorkspaceTableAssignmentServiceMock } from "@/features/checkout/backend/reservation/workspace-table-assignment.service.mock";
import {
  type CoworkReservationQuote,
  calculateCoworkReservationQuote,
} from "@/features/checkout/checkout-quote";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import {
  type AffirmedDiscountAdvertisementQuote,
  affirmedDiscountAdvertisementQuoteCodec,
  type DiscountAdvertisementQuote,
  discountAdvertisementQuoteCodec,
} from "@/features/discounts";
import { discountIdSchema } from "@/features/discounts/contracts";
import type { IWorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  ReservationDraftAcquisition,
  type WorkspaceReservationRepository as WorkspaceReservationRepositoryType,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { meetingRoomAdvertisedPriceReservationSchema } from "@/features/reservation/meeting-room-reservation";

mock.module("server-only", () => ({}));

mock.module("@/features/legal/acceptance-snapshot", () => ({
  getLegalAcceptanceSnapshot: mock(() =>
    Effect.succeed({
      privacyPolicy: {
        path: "/legal/privacy.md",
        hash: "privacy-hash",
        hashAlgorithm: "sha256",
      },
    })
  ),
}));

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

const reservation = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  date: "2026-07-01",
  coffee: false,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
};

const { deriveCheckoutAttemptKeys, deriveCheckoutSessionKeys } = await import(
  "@/features/checkout/backend/checkout/checkout-session-key.server"
);
const reusableSessionKeys = deriveCheckoutSessionKeys("session-id");
const reusableAttemptKeys = deriveCheckoutAttemptKeys({
  checkoutSessionId: "session-id",
  checkoutAttemptId: "attempt-id",
  reservation,
});

const reusableHoldExpiresAt = Temporal.Instant.from("2300-07-01T12:00:00.000Z");

const buildAdvertisedPriceToken = async (
  quote: CoworkReservationQuote = buildCoworkReservationQuote(reservation),
  ttlMilliseconds?: number
) => {
  const { buildAdvertisedPriceState, sealAdvertisedPriceState } = await import(
    "@/features/checkout/backend/checkout"
  );
  return Effect.gen(function* () {
    const state = yield* buildAdvertisedPriceState({
      kind: "cowork",
      locale: "en-US",
      reservation: {
        kind: "cowork",
        details: {
          kind: "cowork",
          entryTier: reservation.entryTier,
          coffee: reservation.coffee,
          date: reservation.date,
        },
      },
      quote,
      ttlMilliseconds,
    });
    return yield* sealAdvertisedPriceState(state);
  }).pipe(Effect.runPromise);
};

const buildMeetingRoomAdvertisedPriceToken = async (input: {
  readonly startsAt: string;
  readonly endsAt: string;
}) => {
  const { buildAdvertisedPriceState, sealAdvertisedPriceState } = await import(
    "@/features/checkout/backend/checkout"
  );
  const advertisedReservation = Schema.decodeUnknownSync(
    meetingRoomAdvertisedPriceReservationSchema
  )({
    kind: "meeting-room",
    details: {
      kind: "meeting-room",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    },
  });
  const quoteWithoutFingerprint = Effect.runSync(
    getMeetingRoomReservationQuote(advertisedReservation.details)
  );
  const quote = {
    ...quoteWithoutFingerprint,
    fingerprint: getReservationQuoteFingerprint(
      advertisedReservation.details,
      quoteWithoutFingerprint
    ),
  };

  return Effect.gen(function* () {
    const state = yield* buildAdvertisedPriceState({
      kind: "meeting-room",
      locale: "en-US",
      reservation: advertisedReservation,
      quote,
    });
    return yield* sealAdvertisedPriceState(state);
  }).pipe(Effect.runPromise);
};

const tamperToken = (token: string) => {
  const parts = token.split(".");
  const ciphertext = parts[2] ?? "";
  parts[2] = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;
  return parts.join(".");
};

const basicMoney = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});
const makeAdvertisementQuote = (
  basisPoints?: number,
  label = "Summer sale"
): DiscountAdvertisementQuote => {
  const discountableSubtotal = basicMoney(35_000);
  const amount = basisPoints
    ? Math.round((discountableSubtotal.value * basisPoints) / 10_000)
    : 0;
  return discountAdvertisementQuoteCodec.make({
    product: { kind: "cowork", tier: "basic" },
    discountableSubtotal,
    discounts: basisPoints
      ? [
          {
            discount: {
              id: Schema.decodeUnknownSync(discountIdSchema)("sale"),
              label,
              adjustment: { kind: "percentage", basisPoints },
            },
            subtotalBefore: discountableSubtotal,
            amount: basicMoney(amount),
            subtotalAfter: basicMoney(discountableSubtotal.value - amount),
          },
        ]
      : [],
    totalDiscount: basicMoney(amount),
    discountedSubtotal: basicMoney(discountableSubtotal.value - amount),
  });
};

const buildQuoteFromAdvertisement = (quote: DiscountAdvertisementQuote) =>
  Effect.runSync(
    calculateCoworkReservationQuote(reservation, { discountQuote: quote })
  );

const affirmAdvertisementQuote = (
  quote: DiscountAdvertisementQuote
): AffirmedDiscountAdvertisementQuote =>
  affirmedDiscountAdvertisementQuoteCodec.make(quote);

const makeAdvertisementAffirmation = (basisPoints?: number) => {
  const discountQuote = affirmAdvertisementQuote(
    makeAdvertisementQuote(basisPoints)
  );
  return {
    kind: "cowork" as const,
    reservation: {
      kind: "cowork" as const,
      details: {
        kind: "cowork" as const,
        entryTier: reservation.entryTier,
        coffee: reservation.coffee,
        date: reservation.date,
      },
    },
    discountQuote,
    quote: buildQuoteFromAdvertisement(discountQuote),
  };
};

const makeReusableReservation = (
  overrides: Partial<WorkspaceReservation> = {}
): WorkspaceReservation =>
  ({
    id: "existing-reservation-id",
    checkoutSessionKey: reusableSessionKeys.current,
    checkoutAttemptKey: reusableAttemptKeys.current,
    checkoutSessionIdentityKey: reusableSessionKeys.identity,
    checkoutAttemptIdentityKey: reusableAttemptKeys.identity,
    checkoutSessionCompatibilityKey: reusableSessionKeys.legacy,
    checkoutAttemptCompatibilityKey: reusableAttemptKeys.legacy,
    correlationId: "correlation-id",
    dotyposCustomerId: "customer-id",
    dotyposReservationId: "dotypos-reservation-id",
    customerAccessCode: "ACCESS-123",
    reservationState: "held",
    paymentState: "not_started",
    fulfillmentState: "not_started",
    activePaymentAttemptId: null,
    productTier: "basic",
    productCoffee: false,
    productMonitorOption: null,
    reservationDetails: {
      kind: "cowork",
      entryTier: "basic",
      coffee: false,
    },
    locale: "en-US",
    reservationHoldExpiresAt: reusableHoldExpiresAt,
    reservationHoldExpiredAt: null,
    reservationCreatedAt: Temporal.Instant.from("2026-07-01T09:55:00.000Z"),
    reservationConfirmedAt: null,
    reservationCancelledAt: null,
    paidAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    failureCode: null,
    fulfillmentFailureCode: null,
    createdAt: Temporal.Instant.from("2026-07-01T09:55:00.000Z"),
    updatedAt: Temporal.Instant.from("2026-07-01T09:55:00.000Z"),
    ...overrides,
  }) as WorkspaceReservation;

/**
 * The action observes a reservation more than once while it creates a provider
 * hold.  Keep those observations in one small state machine instead of making
 * each test guess which of its independent mocks is read next.  This mirrors
 * the repository boundary only: tests still seed lookups and inject failures
 * through the callbacks below.
 */
const createStatefulReservationFake = (input: {
  readonly findByAttemptKey: ReturnType<typeof mock>;
  readonly findCurrentByCheckoutSessionKey?: ReturnType<typeof mock>;
  readonly createDraft?: ReturnType<typeof mock>;
  readonly claimHoldCreation?: ReturnType<typeof mock>;
  readonly findById?: ReturnType<typeof mock>;
  readonly claimSupersessionCancellation?: ReturnType<typeof mock>;
  readonly completeSupersessionAndCreateDraft?: ReturnType<typeof mock>;
  readonly markCancellationFailed?: ReturnType<typeof mock>;
}) => {
  const rows = new Map<string, WorkspaceReservation>();
  const storeDraft = (draft: Partial<WorkspaceReservation>) => {
    const row = makeReusableReservation({
      ...draft,
      dotyposReservationId: null,
      failureCode: null,
      fulfillmentState: "not_started",
      paymentState: "not_started",
      reservationState: "draft",
    });
    rows.set(row.id, row);
    return row;
  };
  const createDraft =
    input.createDraft ?? mock((draft) => Effect.succeed(storeDraft(draft)));
  const acquireDraft = mock((draft) =>
    createDraft(draft).pipe(
      Effect.map((created) => {
        const returned = created as Partial<WorkspaceReservation>;
        if (
          returned.reservationState &&
          returned.reservationState !== "draft"
        ) {
          const reservation = makeReusableReservation({
            ...draft,
            ...returned,
          });
          rows.set(reservation.id, reservation);
          return ReservationDraftAcquisition.existing_attempt({ reservation });
        }
        return ReservationDraftAcquisition.created({
          reservation: storeDraft({ ...draft, ...returned }),
        });
      })
    )
  );
  const claimHoldCreation = mock((id: string) => {
    const epoch = `epoch-${id}`;
    const claim = input.claimHoldCreation?.(id) ?? Effect.succeed(epoch);
    return claim.pipe(
      Effect.map((result) => (result === true ? epoch : result))
    );
  });
  const remember = <T extends WorkspaceReservation | null>(row: T) => {
    if (row) rows.set(row.id, row);
    return row;
  };
  const findById = mock((id: string) =>
    (input.findById?.(id) ?? Effect.succeed(rows.get(id) ?? null)).pipe(
      Effect.map(remember)
    )
  );
  const findByAttemptKey = mock((key: string) =>
    input.findByAttemptKey(key).pipe(Effect.map(remember))
  );
  const findCurrentByCheckoutSessionKey = mock((key: string) =>
    (input.findCurrentByCheckoutSessionKey?.(key) ?? Effect.succeed(null)).pipe(
      Effect.map(remember)
    )
  );
  const attachHold = mock((attached) =>
    Effect.sync(() => {
      const current =
        rows.get(attached.id) ?? makeReusableReservation({ id: attached.id });
      rows.set(
        attached.id,
        makeReusableReservation({
          ...current,
          dotyposReservationId: attached.dotyposReservationId,
          reservationCreatedAt: attached.reservationCreatedAt,
          reservationState: "held",
          paymentState: "not_started",
          failureCode: `hold_creation_attached:${attached.epoch}`,
        })
      );
    })
  );
  const completeSupersessionAndCreateDraft = mock((operation) => {
    const complete =
      input.completeSupersessionAndCreateDraft?.(operation) ??
      Effect.succeed(storeDraft(operation.replacement));
    return complete.pipe(Effect.map((created) => storeDraft(created)));
  });
  const claimedCancellationIds = new Set<string>();
  const claimSupersessionCancellation = mock((operation) =>
    (
      input.claimSupersessionCancellation?.(operation) ??
      Effect.succeed(rows.get(operation.id) ?? null)
    ).pipe(
      Effect.map((claimed) => {
        if (claimed) {
          claimedCancellationIds.add(claimed.id);
          rows.set(claimed.id, claimed);
        }
        return claimed;
      })
    )
  );
  const renewCancellationClaim = mock((operation) =>
    Effect.succeed(
      claimedCancellationIds.has(operation.id)
        ? (rows.get(operation.id) ?? null)
        : null
    )
  );
  const markCancellationFailed =
    input.markCancellationFailed ?? mock(() => Effect.void);

  return {
    rows,
    createDraft,
    acquireDraft,
    claimHoldCreation,
    findById,
    attachHold,
    repository: {
      findByAttemptKey,
      findCurrentByCheckoutSessionKey,
      acquireDraft,
      claimHoldCreation,
      beginProviderHoldCreation: mock(() => Effect.succeed(true)),
      recordProviderHoldCandidate: mock(() => Effect.void),
      findById,
      releaseHoldCreation: mock(() => Effect.void),
      updateReservationDetails: mock(() => Effect.void),
      attachHold,
      markAttachFailedCancellationRequired: mock(() => Effect.void),
      claimSupersessionCancellation,
      renewCancellationClaim,
      reclaimPreProviderHoldCreation: mock(() => Effect.succeed(true)),
      completeSupersessionAndCreateDraft,
      markCancelled: mock(() => Effect.void),
      markCancellationFailed,
    },
    completeSupersessionAndCreateDraft,
    markCancellationFailed,
  };
};

const runReusableReservationScenario = async (input: {
  readonly findByAttemptKey: ReturnType<typeof mock>;
  readonly findCurrentByCheckoutSessionKey?: ReturnType<typeof mock>;
  readonly createDraft?: ReturnType<typeof mock>;
  readonly claimHoldCreation?: ReturnType<typeof mock>;
  readonly findById?: ReturnType<typeof mock>;
  readonly claimSupersessionCancellation?: ReturnType<typeof mock>;
  readonly completeSupersessionAndCreateDraft?: ReturnType<typeof mock>;
  readonly cancelReservation?: ReturnType<typeof mock>;
  readonly createReservation?: ReturnType<typeof mock>;
  readonly getReservationStatus?: ReturnType<typeof mock>;
  readonly markCancellationFailed?: ReturnType<typeof mock>;
  readonly advertisedPriceToken?: string;
  readonly affirmAdvertisement?: ReturnType<typeof mock>;
  readonly quoteForCustomer?: ReturnType<typeof mock>;
  readonly keyDerivationClock?: () => Date;
}) => {
  const { prepareWorkspacePayState } = await import("./prepare-pay-state");
  const { WorkspaceCheckoutAccessCodeService } = await import(
    "@/features/checkout/backend/reservation"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const { LegalEvidenceEventRepository } = await import(
    "@/features/checkout/backend/repositories"
  );
  const { ReservationHoldCleanupScheduleService } = await import(
    "@/features/checkout/backend/holds"
  );
  const { WorkspaceAvailabilityService } = await import(
    "@/features/reservation/backend/workspace-availability.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { BotProtectionServiceMock } = await import(
    "@/shared/backend/bot-protection/bot-protection.service.mock"
  );

  const enqueueCleanup = mock(() => Effect.void);
  const updateReservationDetails = mock(() => Effect.void);
  const recordMany = mock((events) => Effect.succeed(events as never));
  const ensureAvailable = mock(() => Effect.void);
  const verifyHuman = mock(() => Effect.void);
  const reservationFake = createStatefulReservationFake(input);
  const createDraft = reservationFake.createDraft;
  const claimHoldCreation = reservationFake.claimHoldCreation;
  const findById = reservationFake.findById;
  const claimSupersessionCancellation =
    reservationFake.repository.claimSupersessionCancellation;
  const completeSupersessionAndCreateDraft =
    reservationFake.completeSupersessionAndCreateDraft;
  const cancelReservation = input.cancelReservation ?? mock(() => Effect.void);
  const createReservation =
    input.createReservation ??
    mock(() => Effect.succeed({ id: "new-dotypos-reservation-id" } as never));
  const getReservationStatus =
    input.getReservationStatus ?? mock(() => Effect.succeed("NEW" as const));
  const markCancellationFailed = reservationFake.markCancellationFailed;
  const affirmAdvertisement =
    input.affirmAdvertisement ??
    mock(() => Effect.succeed(makeAdvertisementAffirmation()));
  const quoteForCustomer =
    input.quoteForCustomer ??
    mock(({ affirmedAdvertisement }) =>
      Effect.succeed(buildQuoteFromAdvertisement(affirmedAdvertisement))
    );
  const quoteForCustomerResult = (
    pricingInput: Parameters<typeof quoteForCustomer>[0]
  ) =>
    quoteForCustomer(pricingInput).pipe(
      Effect.map((quote) => ({
        kind: pricingInput.reservation.kind,
        reservation: pricingInput.reservation,
        quote,
      }))
    );
  const findOrCreateCustomer = mock(() =>
    Effect.succeed({ id: "customer-id" })
  );
  const testLayer = Layer.mergeAll(
    CheckoutPricingServiceMock({
      affirmAdvertisement,
      quoteForCustomer: quoteForCustomerResult as never,
    }),
    BotProtectionServiceMock({ verifyHuman }),
    Layer.succeed(WorkspaceAvailabilityService, {
      getAvailability: mock(() => Effect.die("unused")),
      ensureAvailable,
    } satisfies IWorkspaceAvailabilityService),
    Layer.succeed(WorkspaceReservationRepository, {
      ...reservationFake.repository,
      updateReservationDetails,
    } as unknown as WorkspaceReservationRepositoryType),
    Layer.succeed(WorkspaceCheckoutAccessCodeService, {
      generateCustomerAccessCode: Effect.succeed("ACCESS-123"),
    } satisfies WorkspaceCheckoutAccessCodeServiceType),
    Layer.succeed(LegalEvidenceEventRepository, {
      record: mock(() => Effect.die("unused")),
      recordMany,
    } as unknown as LegalEvidenceEventRepositoryType),
    Layer.succeed(ReservationHoldCleanupScheduleService, {
      enqueueCleanup,
    } as never),
    WorkspaceTableAssignmentServiceMock({
      assignTableId: mock(() => Effect.succeed("table-id")),
    }),
    Layer.succeed(PostHogEventService, {
      capture: mock(() => Effect.void),
    }),
    Layer.succeed(DotyposService, {
      findOrCreateCustomer,
      getReservationStatus,
      cancelReservation,
      prepareReservationCreation: mock((input) =>
        Effect.succeed({ request: input } as never)
      ),
      createPreparedReservation: createReservation,
    } as unknown as typeof DotyposService.Service)
  );

  const result = await prepareWorkspacePayState(
    {
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken:
        input.advertisedPriceToken ?? (await buildAdvertisedPriceToken()),
      reservation,
      legalConsent: true,
    },
    { keyDerivationClock: input.keyDerivationClock }
  ).pipe(Effect.provide(testLayer), Effect.runPromise);

  return {
    result,
    enqueueCleanup,
    updateReservationDetails,
    recordMany,
    ensureAvailable,
    createDraft,
    claimHoldCreation,
    findById,
    claimSupersessionCancellation,
    completeSupersessionAndCreateDraft,
    cancelReservation,
    createReservation,
    getReservationStatus,
    markCancellationFailed,
    verifyHuman,
    affirmAdvertisement,
    quoteForCustomer,
    findOrCreateCustomer,
  };
};

const runMeetingRoomNewHoldScenario = async () => {
  const { prepareWorkspacePayState } = await import("./prepare-pay-state");
  const { CheckoutPricingService } = await import(
    "@/features/checkout/backend/checkout/checkout-pricing.service"
  );
  const { ReservationHoldCleanupScheduleService } = await import(
    "@/features/checkout/backend/holds"
  );
  const { LegalEvidenceEventRepository } = await import(
    "@/features/checkout/backend/repositories"
  );
  const { WorkspaceCheckoutAccessCodeService } = await import(
    "@/features/checkout/backend/reservation"
  );
  const { DiscountServiceMock } = await import(
    "@/features/discounts/discount.service.mock"
  );
  const { WorkspaceAvailabilityService } = await import(
    "@/features/reservation/backend/workspace-availability.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const { BotProtectionServiceMock } = await import(
    "@/shared/backend/bot-protection/bot-protection.service.mock"
  );

  const meetingRoomReservation = {
    kind: "meeting-room" as const,
    startsAt: "2099-06-10T08:00:00Z",
    endsAt: "2099-06-10T12:00:00Z",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420 777 777 777",
  };
  const ensureAvailable = mock(() => Effect.void);
  const createDraft = mock((input) =>
    Effect.succeed({
      id: "meeting-room-reservation-id",
      checkoutSessionKey: input.checkoutSessionKey,
      checkoutAttemptKey: input.checkoutAttemptKey,
      checkoutSessionIdentityKey: input.checkoutSessionIdentityKey,
      checkoutAttemptIdentityKey: input.checkoutAttemptIdentityKey,
      reservationState: "draft",
      reservationDetails: input.reservationDetails,
    } as never)
  );
  const assignTableId = mock(() => Effect.succeed("meeting-room-table-id"));
  const createReservation = mock(() =>
    Effect.succeed({ id: "dotypos-meeting-room-id" } as never)
  );
  const reservationFake = createStatefulReservationFake({
    findByAttemptKey: mock(() => Effect.succeed(null)),
    createDraft,
  });
  const attachHold = reservationFake.attachHold;
  const enqueueCleanup = mock(() => Effect.void);
  const advertisementQuote = discountAdvertisementQuoteCodec.make({
    product: { kind: "meeting-room", durationMinutes: 240 },
    discountableSubtotal: basicMoney(60_000),
    discounts: [],
    totalDiscount: basicMoney(0),
    discountedSubtotal: basicMoney(60_000),
  });
  const affirmedAdvertisement =
    affirmedDiscountAdvertisementQuoteCodec.make(advertisementQuote);
  const affirmAdvertisement = mock(() => Effect.succeed(affirmedAdvertisement));
  const applyCustomerDiscount = mock(() =>
    Effect.succeed(affirmedAdvertisement)
  );
  const discoverAdvertisedDiscounts = mock(
    ({ discountableSubtotal, product }) =>
      Effect.succeed({
        product,
        discountableSubtotal,
        discounts: [],
        totalDiscount: basicMoney(0),
        discountedSubtotal: discountableSubtotal,
      })
  );
  const testLayer = Layer.mergeAll(
    CheckoutPricingService.Live.pipe(
      Layer.provide(
        DiscountServiceMock({
          discoverAdvertisedDiscounts,
          affirmAdvertisement,
          applyCustomerDiscount,
        })
      )
    ),
    BotProtectionServiceMock({ verifyHuman: mock(() => Effect.void) }),
    Layer.succeed(WorkspaceAvailabilityService, {
      getAvailability: mock(() => Effect.die("unused")),
      ensureAvailable,
    } satisfies IWorkspaceAvailabilityService),
    Layer.succeed(WorkspaceReservationRepository, {
      ...reservationFake.repository,
      updateReservationDetails: mock(() => Effect.die("unused")),
    } as unknown as WorkspaceReservationRepositoryType),
    Layer.succeed(WorkspaceCheckoutAccessCodeService, {
      generateCustomerAccessCode: Effect.succeed("ACCESS-123"),
    } satisfies WorkspaceCheckoutAccessCodeServiceType),
    Layer.succeed(LegalEvidenceEventRepository, {
      record: mock(() => Effect.die("unused")),
      recordMany: mock((events) => Effect.succeed(events as never)),
    } as unknown as LegalEvidenceEventRepositoryType),
    WorkspaceTableAssignmentServiceMock({ assignTableId }),
    Layer.succeed(ReservationHoldCleanupScheduleService, {
      enqueueCleanup,
    } as never),
    Layer.succeed(DotyposService, {
      findOrCreateCustomer: mock(() => Effect.succeed({ id: "customer-id" })),
      prepareReservationCreation: mock((input) =>
        Effect.succeed({ request: input } as never)
      ),
      createPreparedReservation: createReservation,
    } as unknown as typeof DotyposService.Service),
    Layer.succeed(PostHogEventService, {
      capture: mock(() => Effect.void),
    })
  );

  const result = await prepareWorkspacePayState({
    locale: "en-US",
    checkoutSessionId: "meeting-room-session-id",
    checkoutAttemptId: "meeting-room-attempt-id",
    advertisedPriceToken: await buildMeetingRoomAdvertisedPriceToken(
      meetingRoomReservation
    ),
    reservation: meetingRoomReservation,
    legalConsent: true,
  }).pipe(Effect.provide(testLayer), Effect.runPromise);

  return {
    result,
    meetingRoomReservation,
    ensureAvailable,
    createDraft,
    assignTableId,
    createReservation,
    attachHold,
    enqueueCleanup,
    affirmAdvertisement,
    applyCustomerDiscount,
  };
};

describe("prepareWorkspacePayState", () => {
  test("accepts meeting-room preparation with its family advertisement", async () => {
    const { preparePayStateSchema } = await import(
      "./prepare-pay-state.schema"
    );
    const result = await preparePayStateSchema["~standard"].validate({
      locale: "en-US",
      checkoutSessionId: "meeting-room-session-id",
      checkoutAttemptId: "meeting-room-attempt-id",
      advertisedPriceToken: "meeting-room-advertised-price-token",
      reservation: {
        kind: "meeting-room",
        startsAt: "2099-06-10T08:00:00Z",
        endsAt: "2099-06-10T12:00:00Z",
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+420 777 777 777",
      },
      legalConsent: true,
    });

    expect(result).not.toHaveProperty("issues");
    expect(result).toHaveProperty("value.reservation.kind", "meeting-room");
  });

  test("keeps meeting-room timing transient while creating its hold", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const scenario = await runMeetingRoomNewHoldScenario();
    const { startsAt, endsAt } = scenario.meetingRoomReservation;

    expect(scenario.ensureAvailable).toHaveBeenCalledWith({
      kind: "meeting-room",
      startsAt,
      endsAt,
    });
    expect(scenario.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutSessionKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        checkoutAttemptKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        reservationDetails: { kind: "meeting-room" },
      })
    );
    const persistedDraft = scenario.createDraft.mock.calls[0]?.[0];
    expect(JSON.stringify(persistedDraft?.reservationDetails)).toBe(
      '{"kind":"meeting-room"}'
    );
    expect(scenario.assignTableId).toHaveBeenCalledWith({
      kind: "meeting-room",
      startsAt,
      endsAt,
    });
    expect(scenario.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          startDate: new Date(startsAt),
          endDate: new Date(endsAt),
          tableId: "meeting-room-table-id",
          status: "NEW",
        }),
      })
    );
    expect(scenario.affirmAdvertisement).toHaveBeenCalledWith(
      expect.objectContaining({
        product: { kind: "meeting-room", durationMinutes: 240 },
        reservationDate: "2099-06-10",
        locale: "en-US",
        advertisedDiscountIds: [],
      })
    );
    expect(scenario.applyCustomerDiscount).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: "customer-id",
        locale: "en-US",
      })
    );
    expect(scenario.attachHold).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "meeting-room-reservation-id",
        dotyposReservationId: "dotypos-meeting-room-id",
      })
    );
    expect(scenario.enqueueCleanup).toHaveBeenCalledTimes(2);

    expect(scenario.result.status).toBe("ready");
    if (scenario.result.status !== "ready") {
      throw new Error("Expected a ready result");
    }
    const token = new URL(
      scenario.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const state = Effect.runSync(openPayState(token ?? ""));
    expect(state.checkoutSessionId).toBe("meeting-room-session-id");
    expect(state.reservation).toMatchObject({
      kind: "meeting-room",
      startsAt,
      endsAt,
    });
    expect(state.quote).toMatchObject({
      items: [
        {
          type: "meeting-room",
          durationMinutes: 240,
          amount: { value: 60_000, exponent: 2, currency: "CZK" },
        },
      ],
      payment: {
        expectedPrice: { value: 60_000, exponent: 2, currency: "CZK" },
      },
    });
  });

  test("creates a held reservation and returns an openable pay state", async () => {
    const { prepareWorkspacePayState } = await import("./prepare-pay-state");
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const { WorkspaceCheckoutAccessCodeService } = await import(
      "@/features/checkout/backend/reservation"
    );
    const { LegalEvidenceEventRepository } = await import(
      "@/features/checkout/backend/repositories"
    );
    const { ReservationHoldCleanupScheduleService } = await import(
      "@/features/checkout/backend/holds"
    );
    const { WorkspaceAvailabilityService } = await import(
      "@/features/reservation/backend/workspace-availability.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const { BotProtectionServiceMock } = await import(
      "@/shared/backend/bot-protection/bot-protection.service.mock"
    );

    const eventOrder: string[] = [];
    const verifyHuman = mock(() =>
      Effect.sync(() => {
        eventOrder.push("bot-verification");
      })
    );
    const ensureAvailable = mock(() =>
      Effect.sync(() => {
        eventOrder.push("availability");
      })
    );
    const createDraft = mock((input) =>
      Effect.succeed({
        id: "reservation-id",
        checkoutSessionKey: input.checkoutSessionKey,
        checkoutAttemptKey: input.checkoutAttemptKey,
        checkoutSessionIdentityKey: input.checkoutSessionIdentityKey,
        checkoutAttemptIdentityKey: input.checkoutAttemptIdentityKey,
        correlationId: "correlation-id",
        reservationState: "draft",
        paymentState: "not_started",
        fulfillmentState: "not_started",
        dotyposCustomerId: input.dotyposCustomerId,
        customerAccessCode: input.customerAccessCode,
        reservationDetails: input.reservationDetails,
        productTier: "basic",
        productCoffee: false,
        productMonitorOption: null,
        locale: input.locale,
        reservationHoldExpiresAt: input.reservationHoldExpiresAt,
      } as never)
    );
    const reservationFake = createStatefulReservationFake({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      createDraft,
    });
    const claimHoldCreation = reservationFake.claimHoldCreation;
    const attachHold = mock((attached) =>
      reservationFake.attachHold(attached).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            eventOrder.push("attach");
          })
        )
      )
    );
    const enqueueCleanup = mock(() =>
      Effect.sync(() => {
        eventOrder.push("enqueue");
      })
    );
    const recordMany = mock((input) => Effect.succeed(input as never));
    const createReservation = mock(() =>
      Effect.succeed({ id: "dotypos-reservation-id" } as never)
    );
    const assignTableId = mock(() => Effect.succeed("table-id"));
    const findOrCreateCustomer = mock(() =>
      Effect.sync(() => {
        eventOrder.push("customer");
        return { id: "customer-id" };
      })
    );
    const affirmAdvertisement = mock(() =>
      Effect.sync(() => {
        eventOrder.push("advertisement");
        return makeAdvertisementAffirmation();
      })
    );
    const quoteForCustomer = mock(({ affirmedAdvertisement }) =>
      Effect.sync(() => {
        eventOrder.push("quote");
        return buildQuoteFromAdvertisement(affirmedAdvertisement);
      })
    );
    const quoteForCustomerResult = (
      pricingInput: Parameters<typeof quoteForCustomer>[0]
    ) =>
      quoteForCustomer(pricingInput).pipe(
        Effect.map((quote) => ({
          kind: pricingInput.reservation.kind,
          reservation: pricingInput.reservation,
          quote,
        }))
      );
    const testLayer = Layer.mergeAll(
      CheckoutPricingServiceMock({
        affirmAdvertisement,
        quoteForCustomer: quoteForCustomerResult as never,
      }),
      BotProtectionServiceMock({ verifyHuman }),
      Layer.succeed(WorkspaceAvailabilityService, {
        getAvailability: mock(() => Effect.die("unused")),
        ensureAvailable,
      } satisfies IWorkspaceAvailabilityService),
      Layer.succeed(WorkspaceReservationRepository, {
        ...reservationFake.repository,
        attachHold,
        updateReservationDetails: mock(() => Effect.die("unused")),
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(WorkspaceCheckoutAccessCodeService, {
        generateCustomerAccessCode: Effect.succeed("ACCESS-123"),
      } satisfies WorkspaceCheckoutAccessCodeServiceType),
      Layer.succeed(LegalEvidenceEventRepository, {
        record: mock(() => Effect.die("unused")),
        recordMany,
      } as unknown as LegalEvidenceEventRepositoryType),
      WorkspaceTableAssignmentServiceMock({
        assignTableId,
      }),
      Layer.succeed(ReservationHoldCleanupScheduleService, {
        enqueueCleanup,
      } as never),
      Layer.succeed(DotyposService, {
        findOrCreateCustomer,
        prepareReservationCreation: mock((input) =>
          Effect.succeed({ request: input } as never)
        ),
        createPreparedReservation: createReservation,
      } as unknown as typeof DotyposService.Service),
      Layer.succeed(PostHogEventService, {
        capture: mock(() => Effect.void),
      })
    );
    const result = await prepareWorkspacePayState({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: await buildAdvertisedPriceToken(),
      reservation,
      legalConsent: true,
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(ensureAvailable).toHaveBeenCalledWith({
      kind: "cowork",
      date: reservation.date,
      entryTier: reservation.entryTier,
      monitorOption: undefined,
    });
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(claimHoldCreation).toHaveBeenCalledWith("reservation-id");
    expect(assignTableId).toHaveBeenCalledWith({
      kind: "cowork",
      entryTier: "basic",
      date: reservation.date,
      coffee: false,
    });
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(attachHold).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        dotyposReservationId: "dotypos-reservation-id",
      })
    );
    expect(enqueueCleanup).toHaveBeenCalledTimes(2);
    expect(enqueueCleanup.mock.calls).toContainEqual([
      expect.objectContaining({
        orderId: "reservation-id",
        reservationHoldExpiresAt: expect.any(Temporal.Instant),
      }),
    ]);
    expect(eventOrder).toEqual([
      "bot-verification",
      "advertisement",
      "customer",
      "availability",
      "quote",
      "attach",
      "enqueue",
      "enqueue",
    ]);
    expect(verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "allow",
    });
    expect(recordMany).toHaveBeenCalledWith([
      expect.objectContaining({
        workspaceReservationId: "reservation-id",
        evidence: expect.objectContaining({ documentHash: "privacy-hash" }),
      }),
    ]);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready result");
    const redirectUrl = new URL(result.redirectUrl, "https://deskohub.test");
    const token = redirectUrl.searchParams.get(payStateTokenQueryParam);
    expect(redirectUrl.searchParams.get("orderId")).toBe("reservation-id");
    expect(token).toBeTruthy();
    const state = Effect.runSync(openPayState(token ?? ""));
    expect(state.orderId).toBe("reservation-id");
    expect(state.checkoutSessionId).toBe("session-id");
    expect(state.submittedCode).toBeUndefined();
    expect(quoteForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: "customer-id",
      })
    );
  });

  test("reuses an immediate retry and refreshes its durable cleanup schedule", async () => {
    const existingReservation = makeReusableReservation();
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(existingReservation)),
    });

    expect(result.result.status).toBe("ready");
    expect(result.ensureAvailable).not.toHaveBeenCalled();
    expect(result.enqueueCleanup).toHaveBeenCalledWith({
      orderId: existingReservation.id,
      reason: "hold_expired",
      reservationHoldExpiresAt: existingReservation.reservationHoldExpiresAt,
    });
    expect(result.verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "allow",
    });
    expect(result.updateReservationDetails).not.toHaveBeenCalled();
    expect(result.findOrCreateCustomer).toHaveBeenCalledTimes(1);
    expect(result.quoteForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: existingReservation.dotyposCustomerId,
      })
    );
  });

  test("reuses an immediate retry stored with the legacy attempt digest", async () => {
    const { deriveCheckoutAttemptKeyCandidates } = await import(
      "@/features/checkout/backend/checkout/checkout-session-key.server"
    );
    const [, legacyAttemptKey] = deriveCheckoutAttemptKeyCandidates({
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      reservation,
    });
    if (!legacyAttemptKey) {
      throw new Error("Expected a synthetic legacy checkout attempt key.");
    }
    const existingReservation = makeReusableReservation({
      checkoutAttemptKey: legacyAttemptKey,
      checkoutAttemptIdentityKey: legacyAttemptKey,
      checkoutAttemptCompatibilityKey: legacyAttemptKey,
    });
    const findByAttemptKey = mock((candidate: string) =>
      Effect.succeed(
        candidate === legacyAttemptKey ? existingReservation : null
      )
    );
    const result = await runReusableReservationScenario({ findByAttemptKey });

    expect(result.result.status).toBe("ready");
    expect(findByAttemptKey).toHaveBeenCalledTimes(2);
    expect(result.createDraft).not.toHaveBeenCalled();
    expect(result.enqueueCleanup).toHaveBeenCalledWith({
      orderId: existingReservation.id,
      reason: "hold_expired",
      reservationHoldExpiresAt: existingReservation.reservationHoldExpiresAt,
    });
  });

  test("reuses a held reservation returned by a conflicting draft insert", async () => {
    const claimConflictReservation = makeReusableReservation({
      id: "claim-conflict-reservation-id",
    });
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      createDraft: mock((input) =>
        Effect.succeed({
          ...claimConflictReservation,
          checkoutSessionKey: input.checkoutSessionKey,
          checkoutAttemptKey: input.checkoutAttemptKey,
          checkoutSessionIdentityKey: input.checkoutSessionIdentityKey,
          checkoutAttemptIdentityKey: input.checkoutAttemptIdentityKey,
        })
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.claimHoldCreation).not.toHaveBeenCalled();
    expect(result.findById).toHaveBeenCalledWith(claimConflictReservation.id);
    expect(result.enqueueCleanup).toHaveBeenCalledWith({
      orderId: claimConflictReservation.id,
      reason: "hold_expired",
      reservationHoldExpiresAt:
        claimConflictReservation.reservationHoldExpiresAt,
    });
    expect(result.quoteForCustomer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dotyposCustomerId: claimConflictReservation.dotyposCustomerId,
      })
    );
  });

  test("re-queries the attempt after another request completes session supersession", async () => {
    const cancellingReservation = makeReusableReservation({
      reservationState: "cancelling",
    });
    const replacementReservation = makeReusableReservation({
      id: "replacement-reservation-id",
    });
    let attemptLookupCount = 0;
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() =>
        Effect.succeed(
          attemptLookupCount++ === 0 ? null : replacementReservation
        )
      ),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(cancellingReservation)
      ),
      findById: mock((id: string) =>
        Effect.succeed(
          id === cancellingReservation.id
            ? makeReusableReservation({
                id,
                reservationState: "cancelled",
              })
            : replacementReservation
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(attemptLookupCount).toBe(2);
    expect(result.cancelReservation).not.toHaveBeenCalled();
    expect(result.createDraft).not.toHaveBeenCalled();
    expect(result.claimHoldCreation).not.toHaveBeenCalled();
  });

  test("cancels the previous hold before creating a replacement in the same checkout session", async () => {
    const previousReservation = makeReusableReservation({
      id: "previous-reservation-id",
      dotyposReservationId: "previous-dotypos-reservation-id",
    });
    const lifecycleEvents: string[] = [];
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(previousReservation)
      ),
      claimSupersessionCancellation: mock(() =>
        Effect.succeed(previousReservation)
      ),
      cancelReservation: mock(() =>
        Effect.sync(() => {
          lifecycleEvents.push("cancel-previous-dotypos-reservation");
        })
      ),
      completeSupersessionAndCreateDraft: mock((input) =>
        Effect.sync(() => {
          lifecycleEvents.push("cancel-local-and-create-replacement-draft");
          return makeReusableReservation({
            id: "replacement-reservation-id",
            checkoutSessionKey: input.replacement.checkoutSessionKey,
            checkoutAttemptKey: input.replacement.checkoutAttemptKey,
            checkoutSessionIdentityKey:
              input.replacement.checkoutSessionIdentityKey,
            checkoutAttemptIdentityKey:
              input.replacement.checkoutAttemptIdentityKey,
            dotyposReservationId: null,
            reservationState: "draft",
          });
        })
      ),
      createReservation: mock(() =>
        Effect.sync(() => {
          lifecycleEvents.push("create-replacement-dotypos-reservation");
          return { id: "replacement-dotypos-reservation-id" } as never;
        })
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.cancelReservation).toHaveBeenCalledWith(
      "previous-dotypos-reservation-id"
    );
    expect(result.claimSupersessionCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "previous-reservation-id",
        ownerId: expect.any(String),
      })
    );
    expect(result.completeSupersessionAndCreateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelledReservationId: "previous-reservation-id",
        replacement: expect.objectContaining({
          checkoutSessionKey: expect.any(String),
          checkoutAttemptKey: expect.any(String),
        }),
      })
    );
    expect(lifecycleEvents).toEqual([
      "cancel-previous-dotypos-reservation",
      "cancel-local-and-create-replacement-draft",
      "create-replacement-dotypos-reservation",
    ]);
  });

  test("rotates the checkout session instead of cancelling a reservation with pending payment", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const pendingReservation = makeReusableReservation({
      paymentState: "pending",
      activePaymentAttemptId: "payment-attempt-id",
    });
    let currentLookupCount = 0;
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(currentLookupCount++ === 0 ? pendingReservation : null)
      ),
      createDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            id: "rotated-reservation-id",
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            checkoutSessionIdentityKey: input.checkoutSessionIdentityKey,
            checkoutAttemptIdentityKey: input.checkoutAttemptIdentityKey,
            dotyposReservationId: null,
            reservationState: "draft",
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.cancelReservation).not.toHaveBeenCalled();
    expect(result.claimSupersessionCancellation).not.toHaveBeenCalled();
    if (result.result.status !== "ready") throw new Error("Expected ready");
    const token = new URL(
      result.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(Effect.runSync(openPayState(token ?? "")).checkoutSessionId).toBe(
      "attempt-id"
    );
  });

  test("freezes the HMAC schedule once across session rotation and deadline crossing", async () => {
    const { deriveCheckoutAttemptKeyCandidates } = await import(
      "@/features/checkout/backend/checkout/checkout-session-key.server"
    );
    const beforeDeadline = new Date("2098-12-31T23:59:59.999Z");
    let currentLookupCount = 0;
    const pendingReservation = makeReusableReservation({
      paymentState: "pending",
      activePaymentAttemptId: "payment-attempt-id",
    });
    const findByAttemptKey = mock(() => Effect.succeed(null));
    setSystemTime(beforeDeadline);
    const result = await runReusableReservationScenario({
      findByAttemptKey,
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(currentLookupCount++ === 0 ? pendingReservation : null)
      ),
      createDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            id: "rotated-reservation-id",
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            checkoutSessionIdentityKey: input.checkoutSessionIdentityKey,
            checkoutAttemptIdentityKey: input.checkoutAttemptIdentityKey,
            dotyposReservationId: null,
            reservationState: "draft",
          })
        )
      ),
    });
    setSystemTime();
    const rotatedCandidates = deriveCheckoutAttemptKeyCandidates(
      {
        checkoutSessionId: "attempt-id",
        checkoutAttemptId: "attempt-id",
        reservation,
      },
      { now: () => beforeDeadline }
    );

    expect(result.result.status).toBe("ready");
    expect(rotatedCandidates).toHaveLength(2);
    const attemptLookups = findByAttemptKey.mock.calls.map(([key]) => key);
    expect(attemptLookups).toHaveLength(6);
    expect(new Set(attemptLookups).size).toBe(4);
  });

  test("keeps the rotated checkout session when superseding its current reservation", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const { deriveCheckoutSessionKeyCandidates } = await import(
      "@/features/checkout/backend/checkout/checkout-session-key.server"
    );
    const [initialSessionKey] =
      deriveCheckoutSessionKeyCandidates("session-id");
    const [rotatedSessionKey] =
      deriveCheckoutSessionKeyCandidates("attempt-id");
    const pendingReservation = makeReusableReservation({
      id: "pending-reservation-id",
      checkoutSessionKey: initialSessionKey,
      paymentState: "pending",
      activePaymentAttemptId: "payment-attempt-id",
    });
    const rotatedSessionReservation = makeReusableReservation({
      id: "rotated-session-reservation-id",
      checkoutSessionKey: rotatedSessionKey,
      dotyposReservationId: "rotated-session-dotypos-reservation-id",
    });
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock((candidate: string) =>
        Effect.succeed(
          candidate === initialSessionKey
            ? pendingReservation
            : candidate === rotatedSessionKey
              ? rotatedSessionReservation
              : null
        )
      ),
      claimSupersessionCancellation: mock(() =>
        Effect.succeed(rotatedSessionReservation)
      ),
      completeSupersessionAndCreateDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            id: "rotated-session-replacement-id",
            checkoutSessionKey: input.replacement.checkoutSessionKey,
            checkoutAttemptKey: input.replacement.checkoutAttemptKey,
            checkoutSessionIdentityKey:
              input.replacement.checkoutSessionIdentityKey,
            checkoutAttemptIdentityKey:
              input.replacement.checkoutAttemptIdentityKey,
            dotyposReservationId: null,
            reservationState: "draft",
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.cancelReservation).toHaveBeenCalledWith(
      "rotated-session-dotypos-reservation-id"
    );
    if (result.result.status !== "ready") throw new Error("Expected ready");
    const token = new URL(
      result.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(Effect.runSync(openPayState(token ?? "")).checkoutSessionId).toBe(
      "attempt-id"
    );
  });

  test("marks a failed cancellation and creates the replacement in a rotated checkout session", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const previousReservation = makeReusableReservation();
    let currentLookupCount = 0;
    const markCancellationFailed = mock(() => Effect.void);
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(currentLookupCount++ === 0 ? previousReservation : null)
      ),
      claimSupersessionCancellation: mock(() =>
        Effect.succeed(previousReservation)
      ),
      cancelReservation: mock(() =>
        Effect.fail(new Error("Dotypos cancellation failed"))
      ),
      markCancellationFailed,
      createDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            id: "rotated-reservation-id",
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            checkoutSessionIdentityKey: input.checkoutSessionIdentityKey,
            checkoutAttemptIdentityKey: input.checkoutAttemptIdentityKey,
            dotyposReservationId: null,
            reservationState: "draft",
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(markCancellationFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: previousReservation.id,
        ownerId: expect.any(String),
        disposition: "retryable",
        recoveryReason: "supersession_recovery",
        failureCode: "checkout_supersession_cancel_failed",
      })
    );
    if (result.result.status !== "ready") throw new Error("Expected ready");
    const token = new URL(
      result.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(Effect.runSync(openPayState(token ?? "")).checkoutSessionId).toBe(
      "attempt-id"
    );
  });

  test("does not cancel a Dotypos reservation that is no longer pending", async () => {
    const previousReservation = makeReusableReservation();
    let currentLookupCount = 0;
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(currentLookupCount++ === 0 ? previousReservation : null)
      ),
      claimSupersessionCancellation: mock(() =>
        Effect.succeed(previousReservation)
      ),
      getReservationStatus: mock(() => Effect.succeed("CONFIRMED" as const)),
      createDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            id: "rotated-reservation-id",
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            checkoutSessionIdentityKey: input.checkoutSessionIdentityKey,
            checkoutAttemptIdentityKey: input.checkoutAttemptIdentityKey,
            dotyposReservationId: null,
            reservationState: "draft",
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.cancelReservation).not.toHaveBeenCalled();
    expect(result.markCancellationFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: previousReservation.id,
        ownerId: expect.any(String),
        disposition: "manual_review",
        recoveryReason: "supersession_recovery",
        failureCode: "checkout_supersession_cancel_failed",
      })
    );
  });

  test("rejects a tampered advertised-price snapshot before downstream work", async () => {
    const { prepareWorkspacePayState } = await import("./prepare-pay-state");
    const { BotProtectionServiceMock } = await import(
      "@/shared/backend/bot-protection/bot-protection.service.mock"
    );
    const token = await buildAdvertisedPriceToken();
    const effect = prepareWorkspacePayState({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: tamperToken(token),
      reservation,
      legalConsent: true,
    }).pipe(
      Effect.provide(
        Layer.merge(
          BotProtectionServiceMock({ verifyHuman: () => Effect.void }),
          CheckoutPricingServiceMock({})
        )
      )
    ) as Effect.Effect<never, unknown, never>;

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      cause: {
        _tag: "AdvertisedPriceMismatchError",
        reason: "invalid_token",
      },
    });
  });

  test("rejects a snapshot for different reservation inputs", async () => {
    const { prepareWorkspacePayState } = await import("./prepare-pay-state");
    const { BotProtectionServiceMock } = await import(
      "@/shared/backend/bot-protection/bot-protection.service.mock"
    );
    const effect = prepareWorkspacePayState({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: await buildAdvertisedPriceToken(),
      reservation: { ...reservation, coffee: true },
      legalConsent: true,
    }).pipe(
      Effect.provide(
        Layer.merge(
          BotProtectionServiceMock({ verifyHuman: () => Effect.void }),
          CheckoutPricingServiceMock({})
        )
      )
    ) as Effect.Effect<never, unknown, never>;

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      cause: {
        _tag: "AdvertisedPriceMismatchError",
        reason: "input_mismatch",
      },
    });
  });

  test("rejects an expired advertised-price snapshot", async () => {
    const { prepareWorkspacePayState } = await import("./prepare-pay-state");
    const { BotProtectionServiceMock } = await import(
      "@/shared/backend/bot-protection/bot-protection.service.mock"
    );
    const effect = prepareWorkspacePayState({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: await buildAdvertisedPriceToken(
        buildCoworkReservationQuote(reservation),
        -1000
      ),
      reservation,
      legalConsent: true,
    }).pipe(
      Effect.provide(
        Layer.merge(
          BotProtectionServiceMock({ verifyHuman: () => Effect.void }),
          CheckoutPricingServiceMock({})
        )
      )
    ) as Effect.Effect<never, unknown, never>;

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      cause: {
        _tag: "AdvertisedPriceMismatchError",
        reason: "invalid_token",
      },
    });
  });

  test("returns a usable pricing_changed summary when an advertised sale disappears", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const advertisedDiscount = makeAdvertisementQuote(5000);
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(makeReusableReservation())),
      advertisedPriceToken: await buildAdvertisedPriceToken(
        buildQuoteFromAdvertisement(advertisedDiscount)
      ),
      affirmAdvertisement: mock(() =>
        Effect.succeed(makeAdvertisementAffirmation())
      ),
    });

    expect(result.result).toMatchObject({
      status: "pricing_changed",
      affectedProductKeys: ["product:cowork:basic"],
    });
    if (result.result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    const token = new URL(
      result.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const state = Effect.runSync(openPayState(token ?? ""));
    expect(state.changedKeys?.itemKeys).toContain("product:cowork:basic");
    expect(state.quote.payment.discounts).toEqual([]);
    expect(state.checkoutSessionId).toBe("session-id");
  });

  test("allows the customer discount to first appear on a ready summary", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const customerQuote = makeAdvertisementQuote(1000, "Customer discount");
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(makeReusableReservation())),
      quoteForCustomer: mock(() =>
        Effect.succeed(buildQuoteFromAdvertisement(customerQuote))
      ),
    });

    expect(result.result.status).toBe("ready");
    if (result.result.status !== "ready") {
      throw new Error("Expected ready result");
    }
    const token = new URL(
      result.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const state = Effect.runSync(openPayState(token ?? ""));
    expect(state.changedKeys).toBeUndefined();
    expect(state.quote.payment.discounts).toHaveLength(1);
    expect(state.quote.payment.discounts[0]?.discount.label).toBe(
      "Customer discount"
    );
  });

  test("rejects a classified bot before resolving downstream services", async () => {
    const { prepareWorkspacePayState } = await import("./prepare-pay-state");
    const { BotDetectedError } = await import(
      "@/shared/backend/bot-protection/bot-protection.service"
    );
    const { BotProtectionServiceMock } = await import(
      "@/shared/backend/bot-protection/bot-protection.service.mock"
    );
    const { m } = await import("@/features/i18n");
    const verifyHuman = mock(() =>
      Effect.fail(
        new BotDetectedError({ message: "Automated request detected" })
      )
    );
    const effect = prepareWorkspacePayState({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: "invalid-but-bot-rejects-first",
      reservation,
      legalConsent: true,
    }).pipe(
      Effect.provide(
        Layer.merge(
          BotProtectionServiceMock({ verifyHuman }),
          CheckoutPricingServiceMock({})
        )
      )
    ) as Effect.Effect<never, unknown, never>;

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      message: m.reservationRateLimitMessage({}, { locale: "en-US" }),
    });
    expect(verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "allow",
    });
  });
});
