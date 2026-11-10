import type { Locale } from "@/features/i18n";
import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import {
  afterEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import {
  type DotyposCustomerId,
  DotyposService,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { EmailRecipientDomainServiceMock } from "@deskohub/email/backend/recipient-domain.service.mock";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Duration, Effect, Fiber, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerMarketingConsents,
  type WorkspaceReservationRow,
} from "@/db/schema";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import type { CustomerAccountSectionsFixture } from "@/features/account/backend/customer-account-sections.test-utils";
import type { CustomerAccountSession } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import { CheckoutPricingServiceMock } from "@/features/checkout/backend/checkout/checkout-pricing.service.mock";
import { WorkspaceTableAssignmentServiceMock } from "@/features/checkout/backend/reservation/workspace-table-assignment.service.mock";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { getWorkspaceMeetingRoomPriceForDuration } from "@/features/checkout/product-catalog";
import {
  buildCoworkReservationQuote as buildCoworkReservationQuoteEffect,
  type CoworkReservationQuote,
} from "@/features/checkout/reservation-quote-cowork";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import {
  type AffirmedDiscountAdvertisementQuote,
  affirmedDiscountAdvertisementQuoteCodec,
  type DiscountAdvertisementQuote,
  discountAdvertisementQuoteCodec,
} from "@/features/discounts";
import {
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import {
  DiscountAffirmationUnavailableError,
  PromotionCodeUnavailableError,
} from "@/features/discounts/errors";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type { AnalyticsConsentMirrorRecord } from "@/features/legal/backend/analytics-consent-ledger";
import type {
  IMarketingConsentLedger,
  MarketingConsentLedger as MarketingConsentLedgerService,
} from "@/features/legal/backend/marketing-consent-ledger";
import { getLegalDocumentVersion } from "@/features/legal/document-version";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralError } from "@/features/referrals/contracts";
import type { ReferralService } from "@/features/referrals/referral.service";
import {
  ReferralServiceMock,
  WithheldReferralService,
} from "@/features/referrals/referral.service.mock";
import { getReferralBenefitIds } from "@/features/referrals/referral-benefits";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import type { IWorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import type { CreateWorkspaceReservationDraftInput } from "@/features/reservation/backend/workspace-reservation.repository";
import { meetingRoomAdvertisedPriceReservationSchema } from "@/features/reservation/meeting-room-reservation";
import type { ReservationBillingSelectionInput } from "@/features/reservation/reservation-billing";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { NoReviewAccounts } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import { getSlowestSuccessfulCalendarLoad } from "@/shared/backend/config/google-calendar.config.test-utils";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";
import { savedConsentCookie } from "@/shared/testing/consent-cookie.test-utils";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { PreparePayStateInput } from "./prepare-pay-state.schema";

const testEmailAddressForAda = testEmailAddress("ada");
const testEmailAddressForGrace = testEmailAddress("grace");

mock.module("server-only", () => ({}));

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

type ContactAccount = Effect.Success<
  CustomerAccountContactService["Service"]["currentAccount"]
>;
type PeekedStanding = Effect.Success<CurrentCustomerAccount["Service"]["peek"]>;

/** The standing behind a contact reader's account, with no review marker. */
const standingOfContactAccount = (account: ContactAccount): PeekedStanding => {
  if (account.status === "signed-out") return { kind: "signed-out" };
  const session = {
    accountId: account.accountId,
    email: account.email,
    deletionRequested: false,
    ...testSessionProfile,
  } satisfies CustomerAccountSession;
  if (account.status === "unlinked") {
    return { kind: "unlinked", session, reviewMarker: "absent" };
  }
  return {
    kind: "linked",
    session,
    reviewMarker: "absent",
    account: {
      accountId: account.accountId,
      dotyposCustomerId: account.dotyposCustomerId,
    },
    autoLinked: false,
  };
};

const inertRememberedReferral = () =>
  RememberedReferral.inMemory({}).pipe(
    Layer.provide(
      Layer.mergeAll(
        ReferralReleaseGate.fromDecision(true),
        WithheldReferralService,
        Layer.mock(CustomerAccountContactService, {})
      )
    )
  );

// Format of the checkout lookup keys new rows store: the active key's
// key-ID-prefixed digest.
const storedLookupKeyPattern = /^test:[a-f0-9]{64}$/;
/** Referral reads that reached no verdict. */
const dotyposOutage = new DotyposUnavailable({
  operation: "listReservations",
  reason: "server",
});
const databaseOutage = new EffectDrizzleQueryError({
  query: "referral code lookup",
  params: [],
  cause: new Error("database unavailable"),
});

const testDatabase = await connectWorkspacePostgresTestDatabase();

const reservation = {
  kind: "cowork" as const,
  entryTier: "open-space" as const,
  date: "2026-07-01",
  coffee: false,
  name: "Ada Lovelace",
  email: testEmailAddressForAda,
  phone: "+420 777 777 777",
  billing: { purpose: "personal" as const, invoice: "none" as const },
};

afterEach(() => setSystemTime());

const reusableHoldExpiresAt = Temporal.Instant.from("2030-07-01T12:00:00.000Z");

const meetingRoomReservationInput = {
  kind: "meeting-room" as const,
  duration: { unit: "hour" as const, amount: 4 as const },
  reservationDate: "2099-06-10",
  startsAt: "2099-06-10T08:00:00Z",
  endsAt: "2099-06-10T12:00:00Z",
  name: "Ada Lovelace",
  email: testEmailAddressForAda,
  phone: "+420 777 777 777",
};

/**
 * Runs `effect` on a TestClock that advances a second at a time until it
 * finishes, so a wait for an in-flight reservation runs out its 40-second
 * window at once. The stubs answer without real-time timers.
 */
const withSecondSleeps = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    while (fiber.pollUnsafe() === undefined) {
      // Lets the event loop settle real async work, such as Pay-state
      // sealing, between steps.
      yield* Effect.promise(
        () => new Promise<void>((resolve) => setImmediate(resolve))
      );
      yield* TestClock.adjust("1 second");
    }
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer()));

const withInstant = <A, E, R>(
  instant: Temporal.Instant,
  effect: Effect.Effect<A, E, R>
) =>
  TestClock.setTime(instant.epochMilliseconds).pipe(
    Effect.andThen(effect),
    Effect.provide(TestClock.layer())
  );

const buildAdvertisedPriceToken = async (
  quote: CoworkReservationQuote = buildCoworkReservationQuote(reservation),
  ttlMilliseconds?: number,
  locale: Locale = "en-US",
  requestedDiscountCode?: string,
  at?: Temporal.Instant,
  coworkReservation = reservation
) => {
  const { buildAdvertisedPriceState, sealAdvertisedPriceState } = await import(
    "@/features/checkout/backend/checkout"
  );
  const effect = Effect.gen(function* () {
    const state = yield* buildAdvertisedPriceState({
      kind: "cowork",
      locale,
      reservation: {
        kind: "cowork",
        details: {
          kind: "cowork",
          entryTier: coworkReservation.entryTier,
          coffee: coworkReservation.coffee,
          date: coworkReservation.date,
        },
      },
      quote,
      ttlMilliseconds,
      ...(requestedDiscountCode !== undefined && {
        requestedDiscountCode: Schema.decodeUnknownSync(
          canonicalPromotionCodeSchema
        )(requestedDiscountCode),
      }),
    });
    return yield* sealAdvertisedPriceState(state);
  });
  return (at ? withInstant(at, effect) : effect).pipe(
    Effect.provide(TestSealedStateKeys),
    Effect.runPromise
  );
};

const buildMeetingRoomAdvertisedPriceToken = async (
  input: {
    readonly duration:
      | { readonly unit: "hour"; readonly amount: 1 | 4 }
      | { readonly unit: "day"; readonly amount: 1 };
    readonly reservationDate: string;
  },
  locale: "en-US" | "cs-CZ" = "en-US",
  metadata: {
    readonly requestedDiscountCode?: string;
  } = {}
) => {
  const { buildAdvertisedPriceState, sealAdvertisedPriceState } = await import(
    "@/features/checkout/backend/checkout"
  );
  const advertisedReservation = Schema.decodeUnknownSync(
    meetingRoomAdvertisedPriceReservationSchema
  )({
    kind: "meeting-room",
    details: {
      kind: "meeting-room",
      duration: input.duration,
      reservationDate: input.reservationDate,
      // Every meeting-room fixture here ends on its start date.
      lastServiceDate: input.reservationDate,
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
      locale,
      reservation: advertisedReservation,
      quote,
      ...(metadata.requestedDiscountCode !== undefined && {
        requestedDiscountCode: Schema.decodeUnknownSync(
          canonicalPromotionCodeSchema
        )(metadata.requestedDiscountCode),
      }),
    });
    return yield* sealAdvertisedPriceState(state);
  }).pipe(Effect.provide(TestSealedStateKeys), Effect.runPromise);
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
  const discountableSubtotal = basicMoney(29_000);
  const amount = basisPoints
    ? Math.round((discountableSubtotal.value * basisPoints) / 10_000)
    : 0;
  return discountAdvertisementQuoteCodec.make({
    product: { kind: "cowork", tier: "open-space" },
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
    buildCoworkReservationQuoteEffect(reservation, { discountQuote: quote })
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

/** The account the activity fixture signs in, and so the author it resumes. */
const signedInAccountId = "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01";

const makeReusableReservation = (
  overrides: Partial<WorkspaceReservationRow> = {}
): WorkspaceReservationRow =>
  ({
    id: "existing-reservation-id",
    authorAccountId: signedInAccountId,
    checkoutSessionKey: "session-key",
    checkoutAttemptKey: "attempt-key",
    correlationId: "correlation-id",
    dotyposCustomerId: "customer-id",
    dotyposReservationId: "dotypos-reservation-id",
    agentClientId: null,
    reservationState: "held",
    paymentState: "not_started",
    fulfillmentState: "not_started",
    activePaymentAttemptId: null,
    productTier: "basic",
    productCoffee: false,
    productMonitorOption: null,
    reservationDetails: {
      kind: "cowork",
      entryTier: "open-space",
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
  }) as WorkspaceReservationRow;

/**
 * Hold acquisition that reuses `reservation`, the attempt's live hold, in the
 * submitted session, for booking cases that only need that outcome.
 */
const reuseHold = (reservation: WorkspaceReservationRow) =>
  mock((request: { readonly checkout: { readonly sessionId: string } }) =>
    Effect.succeed({
      kind: "reused" as const,
      reservation,
      checkoutSessionId: request.checkout.sessionId,
    })
  );

// Only a signed-in account books, so scenarios run signed in unless they
// pass their own session authority.
const accountAuthorityFixture = async (
  options: CustomerAccountSectionsFixture = {
    session: {},
    activityState: "active",
  }
) => {
  const { makeCustomerAccountSections } = await import(
    "@/features/account/backend/customer-account-sections.test-utils"
  );
  const sections = makeCustomerAccountSections(options);
  // The signed-in account is an ordinary customer, not a review account.
  return { ...sections, layer: Layer.merge(sections.layer, NoReviewAccounts) };
};

/**
 * Prepares Pay as the reservation form's Server Action does: BotID first,
 * then the shared booking operation, with the form's public messages.
 */
const loadReservationFormPreparation = async (
  options: { readonly holds?: "provided" } = {}
) => {
  const { prepareOverProvidedServices, prepareOverProvidedHolds } =
    await import(
      "@/features/reservation/backend/reservation-booking.test-utils"
    );
  const prepareWorkspacePayState =
    options.holds === "provided"
      ? prepareOverProvidedHolds
      : prepareOverProvidedServices;
  const { toReservationFormError, verifyReservationFormHuman } = await import(
    "./prepare-pay-state-form"
  );
  return (input: PreparePayStateInput) =>
    verifyReservationFormHuman(input.locale).pipe(
      Effect.andThen(
        prepareWorkspacePayState(input).pipe(
          Effect.mapError(toReservationFormError(input))
        )
      )
    );
};

const runReusableReservationScenario = async (input: {
  readonly findByAttemptKeys?: ReturnType<typeof mock>;
  /**
   * Replaces hold acquisition with this `holdForAttempt`, for cases that only
   * need its outcome; the repository and Dotypos hold mocks then go unused.
   */
  readonly holdForAttempt?: ReturnType<typeof mock>;
  readonly findLatestByAgentSelectionKey?: ReturnType<typeof mock>;
  readonly findSupersedableByAgentClient?: ReturnType<typeof mock>;
  readonly findCurrentByCheckoutSessionKey?: ReturnType<typeof mock>;
  readonly findStoredCheckoutSessionKey?: ReturnType<typeof mock>;
  readonly createDraft?: ReturnType<typeof mock>;
  readonly claimHoldCreation?: ReturnType<typeof mock>;
  readonly findById?: ReturnType<typeof mock>;
  readonly claimSupersessionCancellation?: ReturnType<typeof mock>;
  readonly completeSupersessionAndCreateDraft?: ReturnType<typeof mock>;
  readonly cancelReservation?: ReturnType<typeof mock>;
  readonly createReservation?: ReturnType<typeof mock>;
  readonly getReservationStatus?: ReturnType<typeof mock>;
  readonly markCancelled?: ReturnType<typeof mock>;
  readonly markCancellationFailed?: ReturnType<typeof mock>;
  readonly advertisedPriceToken?: string;
  readonly checkoutSessionId?: string;
  readonly checkoutAttemptId?: string;
  readonly now?: Temporal.Instant;
  /** The submission's locale; en-US by default. */
  readonly locale?: Locale;
  readonly marketingConsent?: boolean;
  readonly marketingConsentSource?: "site_tool" | "customer_app";
  /** Replaces the mocked marketing consent ledger. */
  readonly marketingConsentLedger?: Layer.Layer<MarketingConsentLedgerService>;
  /** The `Cookie` header of the booking request; none by default. */
  readonly requestCookie?: string;
  readonly mirrorAnalyticsConsent?: ReturnType<typeof mock>;
  readonly affirmAdvertisement?: ReturnType<typeof mock>;
  readonly quoteForCustomer?: ReturnType<typeof mock>;
  readonly ensureAvailable?: ReturnType<typeof mock>;
  readonly recordMarketingConsent?: ReturnType<typeof mock>;
  readonly findOrCreateCustomer?: ReturnType<typeof mock>;
  readonly reservation?: Omit<typeof reservation, "billing"> & {
    readonly billing: ReservationBillingSelectionInput;
  };
  readonly accountAuthority?: Parameters<typeof accountAuthorityFixture>[0];
  readonly customer?: "account";
  /** The session's account as the contact reader reports it. */
  readonly account?: CustomerAccountContactService["Service"]["currentAccount"];
  /** The standing booking peeks at; by default the one `account` reports. */
  readonly standing?: CurrentCustomerAccount["Service"]["peek"];
  readonly linkedContact?: ReturnType<typeof mock>;
  readonly completeProfile?: ReturnType<typeof mock>;
  readonly linkedAccount?: CustomerAccountContactService["Service"]["currentLinkedAccount"];
  readonly rememberedReferralCode?: string;
  readonly evaluateCheckoutReferral?: ReturnType<typeof mock>;
  readonly findAvailableCode?: ReturnType<typeof mock>;
  readonly hasSettledReferral?: ReturnType<typeof mock>;
  /** Replaces the mocked referral operations above. */
  readonly referralService?: Layer.Layer<ReferralService>;
  readonly checkContactEmailDomain?: ReturnType<typeof mock>;
  /**
   * Books through the customer MCP server's path instead of the form: the
   * shared operation for this agent client, without BotID.
   */
  readonly bookingAgent?: {
    readonly clientId: string;
    readonly selectionKey: string;
  };
  /** Lets waits for in-flight reservations run out their window at once. */
  readonly instantSleeps?: boolean;
  /**
   * Books through a server caller such as the customer HTTP API: the shared
   * operation without BotID or an agent.
   */
  readonly serverCaller?: boolean;
}) => {
  const holdsProvided = input.holdForAttempt !== undefined;
  const prepareFromReservationForm = await loadReservationFormPreparation(
    holdsProvided ? { holds: "provided" } : {}
  );
  const { prepareOverProvidedServices, prepareOverProvidedHolds } =
    await import(
      "@/features/reservation/backend/reservation-booking.test-utils"
    );
  const prepareWorkspacePayState = holdsProvided
    ? prepareOverProvidedHolds
    : prepareOverProvidedServices;
  const { ReservationHolds } = await import(
    "@/features/reservation/backend/reservation-holds.service"
  );
  const { BookingAgent } = await import(
    "@/features/reservation/backend/booking-agent"
  );
  const { recordCheckoutAnalytics } = await import(
    "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
  );
  const { MarketingConsentLedger } = await import(
    "@/features/legal/backend/marketing-consent-ledger"
  );
  const { AnalyticsConsentLedger } = await import(
    "@/features/legal/backend/analytics-consent-ledger"
  );
  const { CurrentWorkspaceRequestHeaders } = await import(
    "@/shared/backend/workspace-request-context"
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
  const recordMarketingConsent =
    input.recordMarketingConsent ?? mock(() => Effect.void);
  const withdrawActiveMarketingConsent = mock(() => Effect.succeed(false));
  const mirrorAnalyticsConsent =
    input.mirrorAnalyticsConsent ?? mock(() => Effect.succeed(true));
  const ensureAvailable = input.ensureAvailable ?? mock(() => Effect.void);
  const verifyHuman = mock(() => Effect.void);
  const findLatestByAgentSelectionKey =
    input.findLatestByAgentSelectionKey ?? mock(() => Effect.succeed([]));
  const findSupersedableByAgentClient =
    input.findSupersedableByAgentClient ?? mock(() => Effect.succeed([]));
  const createDraft = input.createDraft ?? mock(() => Effect.die("unused"));
  const claimHoldCreation =
    input.claimHoldCreation ?? mock(() => Effect.succeed(true));
  const findById = input.findById ?? mock(() => Effect.succeed(null));
  const claimSupersessionCancellation =
    input.claimSupersessionCancellation ?? mock(() => Effect.succeed(null));
  const completeSupersessionAndCreateDraft =
    input.completeSupersessionAndCreateDraft ??
    mock(() => Effect.die("unused"));
  const cancelReservation = input.cancelReservation ?? mock(() => Effect.void);
  const createReservation =
    input.createReservation ??
    mock(() => Effect.succeed({ id: "new-dotypos-reservation-id" } as never));
  const getReservationStatus =
    input.getReservationStatus ?? mock(() => Effect.succeed("NEW" as const));
  const markCancelled = input.markCancelled ?? mock(() => Effect.void);
  const markCancellationFailed =
    input.markCancellationFailed ?? mock(() => Effect.void);
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
  const findOrCreateCustomer =
    input.findOrCreateCustomer ??
    mock(() => Effect.succeed({ id: "customer-id" }));
  const checkContactEmailDomain =
    input.checkContactEmailDomain ??
    mock(() => Effect.succeed("accepts_mail" as const));
  const accountAuthority = await accountAuthorityFixture(
    input.accountAuthority
  );
  // Without a fixture the session has no linked account.
  const readLinkedAccount = mock(
    () => input.linkedAccount ?? Effect.succeed(null)
  );
  // Without an account fixture, the session's account follows its linked
  // account: linked, or signed out.
  const readAccount = mock(
    () =>
      input.account ??
      readLinkedAccount().pipe(
        Effect.map((linked) =>
          linked
            ? ({
                status: "linked",
                email: testEmailAddressForAda,
                ...linked,
              } as never)
            : ({ status: "signed-out" } as never)
        )
      )
  );
  // Booking reads the standing; by default it reports what `account` does.
  const peekStanding = mock(
    () =>
      input.standing ?? readAccount().pipe(Effect.map(standingOfContactAccount))
  );
  const linkedContact =
    input.linkedContact ??
    mock(() => Effect.die("a linked contact must not be read"));
  const completeProfile =
    input.completeProfile ??
    mock(() => Effect.die("no profile may be created"));
  const evaluateCheckoutReferral =
    input.evaluateCheckoutReferral ??
    mock(() => Effect.die("a referral must not be evaluated"));
  const findAvailableCode =
    input.findAvailableCode ??
    mock(() => Effect.die("a referral code must not be looked up"));
  const hasSettledReferral =
    input.hasSettledReferral ?? mock(() => Effect.succeed(false));
  const rememberedReferralCookie = { value: input.rememberedReferralCode };
  const contacts = Layer.mock(CustomerAccountContactService, {
    currentAccount: Effect.suspend(() => readAccount()),
    linkedContact: linkedContact as never,
    completeProfile: completeProfile as never,
    currentLinkedAccount: Effect.suspend(() => readLinkedAccount()),
  });
  const referrals =
    input.referralService ??
    ReferralServiceMock({
      evaluateCheckoutReferral: evaluateCheckoutReferral as never,
      findAvailableCode: findAvailableCode as never,
      hasSettledReferral: hasSettledReferral as never,
    });
  const testLayer = Layer.mergeAll(
    TestSealedStateKeys,
    accountAuthority.layer,
    contacts,
    Layer.mock(CurrentCustomerAccount, {
      peek: Effect.suspend(() => peekStanding()),
    }),
    referrals,
    RememberedReferral.inMemory(rememberedReferralCookie).pipe(
      Layer.provide(
        Layer.mergeAll(
          ReferralReleaseGate.fromDecision(true),
          referrals,
          contacts
        )
      )
    ),
    CheckoutPricingServiceMock({
      affirmCoworkAdvertisement: affirmAdvertisement,
      quoteForCustomer: quoteForCustomerResult as never,
    }),
    EmailRecipientDomainServiceMock({ check: checkContactEmailDomain }),
    Layer.mock(WorkspaceAvailabilityService, {
      getAvailability: mock(() => Effect.die("unused")),
      ensureAvailable,
    } satisfies IWorkspaceAvailabilityService),
    Layer.mock(ReservationHolds, {
      holdForAttempt:
        input.holdForAttempt ?? mock(() => Effect.die("unused") as never),
    }),
    Layer.mock(WorkspaceReservationRepository, {
      findByAttemptKeys:
        input.findByAttemptKeys ?? mock(() => Effect.succeed(null)),
      findLatestByAgentSelectionKey,
      findSupersedableByAgentClient,
      findCurrentByCheckoutSessionKey:
        input.findCurrentByCheckoutSessionKey ??
        mock(() => Effect.succeed(null)),
      findStoredCheckoutSessionKey:
        input.findStoredCheckoutSessionKey ?? mock(() => Effect.succeed(null)),
      createDraft,
      claimHoldCreation,
      findById,
      releaseHoldCreation: mock(() => Effect.void),
      updateReservationDetails,
      attachHold: mock(() => Effect.void),
      markAttachFailedCancellationRequired: mock(() => Effect.void),
      claimSupersessionCancellation,
      completeSupersessionAndCreateDraft,
      markCancelled,
      markCancellationFailed,
    }),
    input.marketingConsentLedger ??
      Layer.mock(MarketingConsentLedger, {
        record: recordMarketingConsent,
        status: mock(() => Effect.succeed("absent")),
        withdrawActive: withdrawActiveMarketingConsent,
      } satisfies IMarketingConsentLedger),
    Layer.mock(AnalyticsConsentLedger, { mirror: mirrorAnalyticsConsent }),
    Layer.mock(ReservationHoldCleanupScheduleService, {
      enqueueCleanup,
    } as never),
    WorkspaceTableAssignmentServiceMock({
      assignTableId: mock(() => Effect.succeed("table-id")),
    }),
    recordCheckoutAnalytics().layer,
    Layer.mock(DotyposService, {
      findOrCreateCustomer,
      getReservationStatus,
      cancelReservation,
      createReservation,
    })
  );

  const submission = {
    locale: input.locale ?? "en-US",
    checkoutSessionId: input.checkoutSessionId ?? "session-id",
    checkoutAttemptId: input.checkoutAttemptId ?? "attempt-id",
    advertisedPriceToken:
      input.advertisedPriceToken ??
      (await buildAdvertisedPriceToken(
        undefined,
        undefined,
        input.locale ?? "en-US",
        undefined,
        input.now,
        input.reservation ?? reservation
      )),
    reservation: input.reservation ?? reservation,
    marketingConsent: input.marketingConsent,
    marketingConsentSource: input.marketingConsentSource,
    customer: input.customer,
  } as PreparePayStateInput;
  const { bookingAgent } = input;
  const callerPreparation = () => {
    if (bookingAgent) {
      return prepareWorkspacePayState(submission).pipe(
        Effect.provideService(BookingAgent, bookingAgent as never)
      );
    }
    if (input.serverCaller) return prepareWorkspacePayState(submission);
    return prepareFromReservationForm(submission).pipe(
      Effect.provide(BotProtectionServiceMock({ verifyHuman }))
    );
  };
  const bookingPreparation = callerPreparation().pipe(
    input.requestCookie === undefined
      ? (preparation) => preparation
      : Effect.provideService(
          CurrentWorkspaceRequestHeaders,
          new Headers({ cookie: input.requestCookie })
        ),
    Effect.provide(testLayer)
  );
  const timedPreparation = input.instantSleeps
    ? withSecondSleeps(
        TestClock.setTime(Date.now()).pipe(Effect.andThen(bookingPreparation))
      )
    : bookingPreparation;
  const result = await (input.now
    ? withInstant(input.now, timedPreparation)
    : timedPreparation
  ).pipe(Effect.result, Effect.runPromise);

  return {
    result: result._tag === "Success" ? result.success : undefined,
    error: result._tag === "Failure" ? (result.failure as unknown) : undefined,
    guardEvents: accountAuthority.events,
    enqueueCleanup,
    updateReservationDetails,
    recordMarketingConsent,
    withdrawActiveMarketingConsent,
    mirrorAnalyticsConsent,
    ensureAvailable,
    findLatestByAgentSelectionKey,
    findSupersedableByAgentClient,
    createDraft,
    claimHoldCreation,
    findById,
    claimSupersessionCancellation,
    completeSupersessionAndCreateDraft,
    cancelReservation,
    createReservation,
    getReservationStatus,
    markCancelled,
    markCancellationFailed,
    verifyHuman,
    affirmAdvertisement,
    quoteForCustomer,
    findOrCreateCustomer,
    readAccount,
    peekStanding,
    linkedContact,
    completeProfile,
    readLinkedAccount,
    evaluateCheckoutReferral,
    findAvailableCode,
    hasSettledReferral,
    rememberedReferralCodeAfter: rememberedReferralCookie.value,
    checkContactEmailDomain,
    holdForAttempt: input.holdForAttempt,
  };
};

const runMeetingRoomNewHoldScenario = async (
  meetingRoomReservation = {
    kind: "meeting-room" as const,
    duration: { unit: "hour" as const, amount: 4 as const },
    reservationDate: "2099-06-10",
    startsAt: "2099-06-10T08:00:00Z",
    endsAt: "2099-06-10T12:00:00Z",
    name: "Ada Lovelace",
    email: testEmailAddressForAda,
    phone: "+420 777 777 777",
  },
  advertisedMetadata: {
    readonly requestedDiscountCode?: string;
  } = {},
  /**
   * Runs the submission under `deadline` on an instant test clock. Each
   * Google Calendar load (the sales affirmation and the availability check's
   * limitations) takes `calendar` and each Dotypos request `dotypos`; the
   * availability check reads both in parallel.
   */
  timing?: {
    readonly calendar: Duration.Duration;
    readonly dotypos: Duration.Duration;
    readonly deadline: Duration.Input;
  }
) => {
  const prepareFromReservationForm = await loadReservationFormPreparation();
  const { withActionDeadline } = await import(
    "@/shared/backend/workspace-action"
  );
  const afterDotypos = <A, E>(effect: Effect.Effect<A, E>) =>
    timing ? Effect.sleep(timing.dotypos).pipe(Effect.andThen(effect)) : effect;
  const { CheckoutPricingService } = await import(
    "@/features/checkout/backend/checkout/checkout-pricing.service"
  );
  const { ReservationHoldCleanupScheduleService } = await import(
    "@/features/checkout/backend/holds"
  );
  const { MarketingConsentLedger } = await import(
    "@/features/legal/backend/marketing-consent-ledger"
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
  const { recordCheckoutAnalytics } = await import(
    "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
  );
  const { BotProtectionServiceMock } = await import(
    "@/shared/backend/bot-protection/bot-protection.service.mock"
  );

  const ensureAvailable = mock(() =>
    timing
      ? Effect.sleep(Duration.max(timing.calendar, timing.dotypos))
      : Effect.void
  );
  const createDraft = mock((input) =>
    Effect.succeed({
      id: "meeting-room-reservation-id",
      authorAccountId: input.authorAccountId,
      checkoutSessionKey: input.checkoutSessionKey,
      checkoutAttemptKey: input.checkoutAttemptKey,
      reservationState: "draft",
      reservationDetails: input.reservationDetails,
    } as never)
  );
  const assignTableId = mock(() =>
    afterDotypos(Effect.succeed("meeting-room-table-id"))
  );
  const createReservation = mock(() =>
    afterDotypos(Effect.succeed({ id: "dotypos-meeting-room-id" } as never))
  );
  const attachHold = mock(() => Effect.void);
  const enqueueCleanup = mock(() => Effect.void);
  const price = getWorkspaceMeetingRoomPriceForDuration(
    meetingRoomReservation.duration
  );
  const advertisementQuote = discountAdvertisementQuoteCodec.make({
    product: {
      kind: "meeting-room",
      duration: meetingRoomReservation.duration,
    },
    discountableSubtotal: price,
    discounts: [],
    totalDiscount: basicMoney(0),
    discountedSubtotal: price,
  });
  const affirmedAdvertisement =
    affirmedDiscountAdvertisementQuoteCodec.make(advertisementQuote);
  const accountAuthority = await accountAuthorityFixture();
  const affirmAdvertisement = mock(() =>
    Effect.sleep(timing?.calendar ?? 0).pipe(Effect.as(affirmedAdvertisement))
  );
  const applyCustomerDiscount = mock(() =>
    Effect.succeed(affirmedAdvertisement)
  );
  const discoverAdvertisedDiscounts = mock(
    ({ discountableSubtotal, product }) =>
      Effect.succeed({
        quote: {
          product,
          discountableSubtotal,
          discounts: [],
          totalDiscount: basicMoney(0),
          discountedSubtotal: discountableSubtotal,
        },
        complete: true,
      })
  );
  const testLayer = Layer.mergeAll(
    TestSealedStateKeys,
    accountAuthority.layer,
    inertRememberedReferral(),
    CheckoutPricingService.Default.pipe(
      Layer.provide(
        DiscountServiceMock({
          discoverAdvertisedDiscounts,
          affirmAdvertisement,
          applyCustomerDiscount,
          previewDiscountCode: mock(() =>
            Effect.fail(
              new PromotionCodeUnavailableError({
                reason: "not_found",
                message: "Unknown code.",
              })
            )
          ),
        })
      )
    ),
    BotProtectionServiceMock({ verifyHuman: mock(() => Effect.void) }),
    EmailRecipientDomainServiceMock({
      check: () => Effect.succeed("accepts_mail" as const),
    }),
    Layer.mock(WorkspaceAvailabilityService, {
      getAvailability: mock(() => Effect.die("unused")),
      ensureAvailable,
    } satisfies IWorkspaceAvailabilityService),
    Layer.mock(WorkspaceReservationRepository, {
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(null)),
      findStoredCheckoutSessionKey: mock(() => Effect.succeed(null)),
      createDraft,
      claimHoldCreation: mock(() => Effect.succeed(true)),
      attachHold,
      findById: mock(() => Effect.succeed(null)),
      releaseHoldCreation: mock(() => Effect.void),
      updateReservationDetails: mock(() => Effect.die("unused")),
      markAttachFailedCancellationRequired: mock(() => Effect.void),
      claimSupersessionCancellation: mock(() => Effect.succeed(null)),
      completeSupersessionAndCreateDraft: mock(() => Effect.die("unused")),
      markCancelled: mock(() => Effect.void),
      markCancellationFailed: mock(() => Effect.void),
    }),
    Layer.mock(MarketingConsentLedger, {
      record: mock(() => Effect.void),
      status: mock(() => Effect.succeed("absent")),
      withdrawActive: mock(() => Effect.succeed(false)),
    } satisfies IMarketingConsentLedger),
    WorkspaceTableAssignmentServiceMock({ assignTableId }),
    Layer.mock(ReservationHoldCleanupScheduleService, {
      enqueueCleanup,
    } as never),
    Layer.mock(DotyposService, {
      findOrCreateCustomer: mock(() =>
        afterDotypos(Effect.succeed({ id: "customer-id" }))
      ),
      createReservation,
    }),
    recordCheckoutAnalytics().layer
  );

  const submission = prepareFromReservationForm({
    locale: "en-US",
    checkoutSessionId: "meeting-room-session-id",
    checkoutAttemptId: "meeting-room-attempt-id",
    advertisedPriceToken: await buildMeetingRoomAdvertisedPriceToken(
      meetingRoomReservation,
      "en-US",
      advertisedMetadata
    ),
    reservation: meetingRoomReservation,
  }).pipe(Effect.provide(testLayer));
  const exit = timing
    ? await submission.pipe(
        withActionDeadline(timing.deadline),
        Effect.exit,
        withInstantSleeps,
        Effect.runPromise
      )
    : undefined;
  const result = timing ? undefined : await Effect.runPromise(submission);

  return {
    exit,
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
  describe.each([
    // Both Calendar loads (sales affirmation, then the availability check's
    // limitations) succeed only on their retry, and the customer, table, and
    // hold Dotypos requests are slow but well within their timeout; together
    // they outlast a budget for one Calendar load.
    ["production", 13],
    ["preview", 6],
  ] as const)(
    "in %s, with Calendar loads that succeed on their retry",
    (deploymentEnvironment, dotyposSeconds) => {
      const runTimedSubmission = (deadline: Duration.Input) =>
        runMeetingRoomNewHoldScenario(undefined, undefined, {
          calendar: getSlowestSuccessfulCalendarLoad(deploymentEnvironment),
          dotypos: Duration.seconds(dotyposSeconds),
          deadline,
        });

      test("prepares the pay state within its deadline", async () => {
        const { getPreparePayStateDeadline } = await import(
          "./prepare-pay-state-deadline"
        );

        const scenario = await runTimedSubmission(
          getPreparePayStateDeadline(deploymentEnvironment)
        );

        expect(scenario.exit).toMatchObject({
          _tag: "Success",
          value: { status: "ready" },
        });
        expect(scenario.createReservation).toHaveBeenCalledTimes(1);
      });

      test("would be interrupted with a budget for one Calendar load", async () => {
        const { getCalendarActionDeadline } = await import(
          "@/shared/backend/calendar-action-deadline"
        );

        const scenario = await runTimedSubmission(
          getCalendarActionDeadline(deploymentEnvironment, 1)
        );

        expect(scenario.exit).toMatchObject({
          _tag: "Failure",
          cause: {
            reasons: [{ error: { _tag: "WorkspaceActionTimeout" } }],
          },
        });
      });
    }
  );

  test("carries the advertised requested discount code into the signed pay state", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const scenario = await runMeetingRoomNewHoldScenario(undefined, {
      requestedDiscountCode: "CAMPAIGN10",
    });

    expect(scenario.result.status).toBe("ready");
    if (scenario.result.status !== "ready") {
      throw new Error("Expected a ready result");
    }
    const token = new URL(
      scenario.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const state = Effect.runSync(
      openPayState(token ?? "").pipe(Effect.provide(TestSealedStateKeys))
    );

    expect(state.requestedDiscountCode).toBe("CAMPAIGN10");
    expect(state.submittedCode).toBeUndefined();
    expect(state.submittedCodeDiscountId).toBeUndefined();
    expect(scenario.result.redirectUrl).not.toContain("CAMPAIGN10");
  });

  test("rejects office reservation issuance while the office flag is disabled", async () => {
    const prepareFromReservationForm = await loadReservationFormPreparation();
    const { recordCheckoutAnalytics } = await import(
      "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
    );
    const { BotProtectionServiceMock } = await import(
      "@/shared/backend/bot-protection/bot-protection.service.mock"
    );
    const verifyHuman = mock(() => Effect.void);
    const { layer: accountAuthorityLayer } = await accountAuthorityFixture();
    const effect = prepareFromReservationForm({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: "disabled-office-has-no-price-token",
      reservation: {
        kind: "office",
        startsOn: "2099-06-10",
        endsOn: "2099-06-11",
        seats: 3,
        name: "Ada Lovelace",
        email: testEmailAddressForAda,
        phone: "+420 777 777 777",
      },
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          accountAuthorityLayer,
          inertRememberedReferral(),
          BotProtectionServiceMock({ verifyHuman }),
          CheckoutPricingServiceMock({}),
          recordCheckoutAnalytics().layer,
          OfficeReleaseGate.Default.pipe(
            Layer.provide(
              WorkspaceFeatureFlagServiceMock({
                isEnabled: mock(() => Effect.succeed(false)),
              })
            )
          )
        )
      )
    ) as Effect.Effect<never, unknown, never>;

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      cause: { _tag: "OfficeReservationsDisabledError" },
    });
    expect(verifyHuman).toHaveBeenCalledTimes(1);
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
        checkoutSessionKey: expect.stringMatching(storedLookupKeyPattern),
        checkoutAttemptKey: expect.stringMatching(storedLookupKeyPattern),
        reservationDetails: {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 4 },
        },
      })
    );
    // The snapshot records the booked offer, never its Dotypos-owned timing.
    const persistedDraft = scenario.createDraft.mock.calls[0]?.[0];
    expect(JSON.stringify(persistedDraft?.reservationDetails)).toBe(
      '{"kind":"meeting-room","duration":{"unit":"hour","amount":4}}'
    );
    expect(scenario.assignTableId).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "meeting-room",
        startsAt,
        endsAt,
      })
    );
    expect(scenario.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: new Date(startsAt),
        endDate: new Date(endsAt),
        tableId: "meeting-room-table-id",
        status: "NEW",
      })
    );
    expect(scenario.affirmAdvertisement).toHaveBeenCalledWith(
      expect.objectContaining({
        product: {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 4 },
        },
        lastServiceDate: "2099-06-10",
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
    expect(scenario.enqueueCleanup).toHaveBeenCalledTimes(1);

    expect(scenario.result.status).toBe("ready");
    if (scenario.result.status !== "ready") {
      throw new Error("Expected a ready result");
    }
    const token = new URL(
      scenario.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const state = Effect.runSync(
      openPayState(token ?? "").pipe(Effect.provide(TestSealedStateKeys))
    );
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
          duration: { unit: "hour", amount: 4 },
          amount: { value: 98_000, exponent: 2, currency: "CZK" },
        },
      ],
      payment: {
        expectedPrice: { value: 98_000, exponent: 2, currency: "CZK" },
      },
    });
  });

  test("allows an already-started calendar-day submission before its end", async () => {
    const localToday = Temporal.Now.zonedDateTimeISO(
      workspaceSiteConstants.location.timeZone
    ).toPlainDate();
    const startsAt = localToday
      .toPlainDateTime()
      .toZonedDateTime(workspaceSiteConstants.location.timeZone)
      .toInstant();
    const endsAt = localToday
      .add({ days: 1 })
      .toPlainDateTime()
      .toZonedDateTime(workspaceSiteConstants.location.timeZone)
      .toInstant();
    const wholeDayReservation = {
      kind: "meeting-room" as const,
      duration: { unit: "day" as const, amount: 1 as const },
      reservationDate: localToday.toString(),
      startsAt: startsAt.toString(),
      endsAt: endsAt.toString(),
      name: "Ada Lovelace",
      email: testEmailAddressForAda,
      phone: "+420 777 777 777",
    };
    const scenario = await runMeetingRoomNewHoldScenario(wholeDayReservation);

    expect(scenario.result.status).toBe("ready");
    expect(scenario.affirmAdvertisement).toHaveBeenCalled();
    expect(scenario.createReservation).toHaveBeenCalled();
  });

  test("creates a held reservation and returns an openable pay state", async () => {
    const prepareFromReservationForm = await loadReservationFormPreparation({
      holds: "provided",
    });
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const { MarketingConsentLedger } = await import(
      "@/features/legal/backend/marketing-consent-ledger"
    );
    const { ReservationHolds } = await import(
      "@/features/reservation/backend/reservation-holds.service"
    );
    const { recordCheckoutAnalytics } = await import(
      "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
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
    // The hold lands in a session other than the submitted one, as after a
    // rotation, so the Pay state must carry the hold's session.
    const holdForAttempt = mock(() =>
      Effect.sync(() => {
        eventOrder.push("hold");
        return {
          kind: "created" as const,
          reservationId: "reservation-id",
          checkoutSessionId: "hold-session-id",
        };
      })
    );
    const recordMarketingConsent = mock(() => Effect.void);
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
    const { layer: accountAuthorityLayer } = await accountAuthorityFixture();
    const testLayer = Layer.mergeAll(
      TestSealedStateKeys,
      accountAuthorityLayer,
      inertRememberedReferral(),
      CheckoutPricingServiceMock({
        affirmCoworkAdvertisement: affirmAdvertisement,
        quoteForCustomer: quoteForCustomerResult as never,
      }),
      BotProtectionServiceMock({ verifyHuman }),
      EmailRecipientDomainServiceMock({
        check: () => Effect.succeed("accepts_mail" as const),
      }),
      Layer.mock(ReservationHolds, { holdForAttempt: holdForAttempt as never }),
      Layer.mock(MarketingConsentLedger, {
        record: recordMarketingConsent,
        status: mock(() => Effect.succeed("absent")),
        withdrawActive: mock(() => Effect.succeed(false)),
      } satisfies IMarketingConsentLedger),
      Layer.mock(DotyposService, { findOrCreateCustomer }),
      recordCheckoutAnalytics().layer
    );
    const result = await prepareFromReservationForm({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: await buildAdvertisedPriceToken(),
      reservation,
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(holdForAttempt).toHaveBeenCalledTimes(1);
    expect(holdForAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        checkout: { sessionId: "session-id", attemptId: "attempt-id" },
        booking: expect.objectContaining({
          customer: "customer-id",
          locale: "en-US",
          purpose: "personal",
        }),
        checkoutDetails: expect.objectContaining({
          reservation: expect.objectContaining({
            kind: "cowork",
            date: reservation.date,
          }),
        }),
      })
    );
    expect(eventOrder).toEqual([
      "bot-verification",
      "advertisement",
      "customer",
      "quote",
      "hold",
    ]);
    expect(verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "allow",
      verifiedBots: { allow: customerAgentNames },
      callSite: "reservation.prepare-pay-state",
    });
    expect(recordMarketingConsent).not.toHaveBeenCalled();

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready result");
    const redirectUrl = new URL(result.redirectUrl, "https://deskohub.test");
    const token = redirectUrl.searchParams.get(payStateTokenQueryParam);
    expect(redirectUrl.searchParams.get("orderId")).toBe("reservation-id");
    expect(token).toBeTruthy();
    const state = Effect.runSync(
      openPayState(token ?? "").pipe(Effect.provide(TestSealedStateKeys))
    );
    expect(state.orderId).toBe("reservation-id");
    expect(state.checkoutSessionId).toBe("hold-session-id");
    expect(state.submittedCode).toBeUndefined();
    // A site tool reports when the prepared Pay URL stops working.
    expect(result.expiresAt).toBe(new Date(state.exp * 1000).toISOString());
    expect(quoteForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: "customer-id",
      })
    );
  });

  test("returns the sealed Pay state token its URL carries", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const scenario = await runReusableReservationScenario({
      holdForAttempt: reuseHold(makeReusableReservation()),
    });

    if (scenario.result?.status !== "ready") {
      throw new Error("Expected ready result");
    }
    const urlToken = new URL(
      scenario.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(scenario.result.payStateToken).toBe(urlToken ?? "");
    const state = Effect.runSync(
      openPayState(scenario.result.payStateToken).pipe(
        Effect.provide(TestSealedStateKeys)
      )
    );
    expect(state.orderId).toBe(scenario.result.orderId);
  });

  test("quotes a hold another request created for the customer it holds", async () => {
    const conflictReservation = makeReusableReservation({
      id: "claim-conflict-reservation-id",
      dotyposCustomerId: "conflict-customer-id",
    });
    const scenario = await runReusableReservationScenario({
      holdForAttempt: mock(() =>
        Effect.succeed({
          kind: "reused",
          reservation: conflictReservation,
          checkoutSessionId: "session-id",
          pricedFor: "conflict-customer-id",
        })
      ),
    });

    expect(scenario.result).toMatchObject({
      status: "ready",
      orderId: "claim-conflict-reservation-id",
    });
    expect(scenario.quoteForCustomer).toHaveBeenLastCalledWith(
      expect.objectContaining({ dotyposCustomerId: "conflict-customer-id" })
    );
  });

  // The hold module has already refreshed the reused hold's details and
  // captured its start by the time this re-quote runs.
  test("surfaces the pricing failure of a reused hold's re-quote for the customer it holds", async () => {
    const repricingFailure = new DiscountAffirmationUnavailableError({
      message: "Discount affirmation unavailable.",
      discountIds: [],
    });
    const scenario = await runReusableReservationScenario({
      holdForAttempt: mock(() =>
        Effect.succeed({
          kind: "reused",
          reservation: makeReusableReservation({
            id: "claim-conflict-reservation-id",
            dotyposCustomerId: "conflict-customer-id",
          }),
          checkoutSessionId: "session-id",
          pricedFor: "conflict-customer-id",
        })
      ),
      serverCaller: true,
      quoteForCustomer: mock(({ affirmedAdvertisement, dotyposCustomerId }) =>
        dotyposCustomerId === "conflict-customer-id"
          ? Effect.fail(repricingFailure)
          : Effect.succeed(buildQuoteFromAdvertisement(affirmedAdvertisement))
      ),
    });

    expect(scenario.result).toBeUndefined();
    expect(scenario.error).toBe(repricingFailure);
    expect(scenario.holdForAttempt).toHaveBeenCalledTimes(1);
    expect(scenario.quoteForCustomer).toHaveBeenLastCalledWith(
      expect.objectContaining({ dotyposCustomerId: "conflict-customer-id" })
    );
  });

  test("re-quotes nothing when holding the attempt fails", async () => {
    const scenario = await runReusableReservationScenario({
      holdForAttempt: mock(() => Effect.fail(databaseOutage)),
      serverCaller: true,
    });

    expect(scenario.result).toBeUndefined();
    expect(scenario.error).toBe(databaseOutage);
    // Only the submission's own quote, taken before the hold.
    expect(scenario.quoteForCustomer).toHaveBeenCalledTimes(1);
  });

  test("reports a contended hold as an error result", async () => {
    const scenario = await runReusableReservationScenario({
      holdForAttempt: mock(() => Effect.succeed({ kind: "contended" })),
    });

    expect(scenario.error).toBeUndefined();
    expect(scenario.result?.status).toBe("error");
  });

  test("records a form opt-in against the resolved customer as an initial grant from the reservation form", async () => {
    const existingReservation = makeReusableReservation();
    const result = await runReusableReservationScenario({
      holdForAttempt: reuseHold(existingReservation),
      marketingConsent: true,
    });

    expect(result.result.status).toBe("ready");
    expect(result.recordMarketingConsent).toHaveBeenCalledWith({
      customerId: "customer-id",
      locale: "en-US",
      choice: "grant",
      mode: "initial",
      channel: "reservation_form",
    });
    // An initial grant keeps an existing row, including a withdrawal.
  });

  describe("analytics consent mirror", () => {
    const savedChoice = savedConsentCookie({
      categories: ["necessary", "analytics"],
      lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
    });

    test("mirrors the booking device's saved choice into the account's ledger", async () => {
      const result = await runReusableReservationScenario({
        holdForAttempt: reuseHold(makeReusableReservation()),
        requestCookie: savedChoice,
      });

      expect(result.result?.status).toBe("ready");
      const [mirrored] = result.mirrorAnalyticsConsent.mock.calls.map(
        ([record]) => record as AnalyticsConsentMirrorRecord
      );
      expect(result.mirrorAnalyticsConsent).toHaveBeenCalledTimes(1);
      expect(mirrored).toMatchObject({
        decision: "grant",
        locale: "en-US",
        source: "hydration_mirror",
      });
      expect(String(mirrored?.decidedAt.pipe(Option.getOrUndefined))).toBe(
        "2026-11-02T09:30:00Z"
      );
    });

    test("books when the mirror fails or dies", async () => {
      const { AnalyticsConsentUnavailable } = await import(
        "@/features/legal/backend/analytics-consent-ledger"
      );
      for (const failure of [
        Effect.fail(new AnalyticsConsentUnavailable({ cause: "down" })),
        Effect.die(new Error("Synthetic mirror defect")),
      ]) {
        const result = await runReusableReservationScenario({
          holdForAttempt: reuseHold(makeReusableReservation()),
          requestCookie: savedChoice,
          mirrorAnalyticsConsent: mock(() => failure),
        });

        expect(result.result?.status).toBe("ready");
      }
    });

    test("mirrors nothing for a request without a saved choice", async () => {
      const result = await runReusableReservationScenario({
        holdForAttempt: reuseHold(makeReusableReservation()),
      });

      expect(result.result?.status).toBe("ready");
      expect(result.mirrorAnalyticsConsent).not.toHaveBeenCalled();
    });

    test("mirrors nothing for a customer agent's booking", async () => {
      const result = await runReusableReservationScenario({
        holdForAttempt: reuseHold(makeReusableReservation()),
        requestCookie: savedChoice,
        bookingAgent: {
          clientId: "https://assistant.example/oauth-client.json",
          selectionKey: "analytics-mirror-agent-selection",
        },
      });

      expect(result.mirrorAnalyticsConsent).not.toHaveBeenCalled();
    });
  });

  test("labels an opt-in submitted through the site's tools", async () => {
    const result = await runReusableReservationScenario({
      holdForAttempt: reuseHold(makeReusableReservation()),
      marketingConsent: true,
      marketingConsentSource: "site_tool",
    });

    expect(result.result.status).toBe("ready");
    expect(result.recordMarketingConsent).toHaveBeenCalledTimes(1);
    expect(result.recordMarketingConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "customer-id",
        choice: "grant",
        mode: "initial",
        channel: "site_tool",
      })
    );
  });

  test("labels an opt-in the customer's app submitted through the customer HTTP API", async () => {
    const result = await runReusableReservationScenario({
      holdForAttempt: reuseHold(makeReusableReservation()),
      marketingConsent: true,
      marketingConsentSource: "customer_app",
      serverCaller: true,
    });

    expect(result.result.status).toBe("ready");
    expect(result.verifyHuman).not.toHaveBeenCalled();
    expect(result.recordMarketingConsent).toHaveBeenCalledTimes(1);
    expect(result.recordMarketingConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "customer-id",
        choice: "grant",
        mode: "initial",
        channel: "customer_app",
      })
    );
  });

  describe("phone region of the submission's locale", () => {
    const submissionIn = (locale: Locale, phone: string) => ({
      locale,
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: "advertised-price-token",
      reservation: { ...reservation, date: "2099-07-01", phone },
    });

    test.each([
      ["de-DE", "0151 23456789"],
      ["uk-UA", "050 123 4567"],
      ["sk-SK", "0905 123 456"],
      ["cs-CZ", "777 123 456"],
      ["en-US", "777 123 456"],
      ["cs-CZ", "+420 777 123 456"],
      ["en-US", "+420 777 123 456"],
      ["de-DE", "+420 777 123 456"],
      ["uk-UA", "+420 777 123 456"],
      ["sk-SK", "+420 777 123 456"],
    ] as const)("accepts a %s submission's phone %s", async (locale, phone) => {
      const { preparePayStateSchema } = await import(
        "./prepare-pay-state.schema"
      );

      const result = await preparePayStateSchema["~standard"].validate(
        submissionIn(locale, phone)
      );

      expect(result.issues).toBeUndefined();
    });

    test.each([
      ["cs-CZ", "0151 23456789"],
      ["cs-CZ", "050 123 4567"],
      ["cs-CZ", "0905 123 456"],
      ["en-US", "0151 23456789"],
    ] as const)("rejects a %s submission's phone %s", async (locale, phone) => {
      const { preparePayStateSchema } = await import(
        "./prepare-pay-state.schema"
      );

      const result = await preparePayStateSchema["~standard"].validate(
        submissionIn(locale, phone)
      );

      expect(result.issues).toEqual([
        expect.objectContaining({ path: ["reservation", "phone"] }),
      ]);
    });

    test("reads the same phone in the region of each submission's own locale", async () => {
      const { preparePayStateSchema } = await import(
        "./prepare-pay-state.schema"
      );

      const german = await preparePayStateSchema["~standard"].validate(
        submissionIn("de-DE", "0151 23456789")
      );
      const czech = await preparePayStateSchema["~standard"].validate(
        submissionIn("cs-CZ", "0151 23456789")
      );

      expect(german.issues).toBeUndefined();
      expect(czech.issues).toEqual([
        expect.objectContaining({ path: ["reservation", "phone"] }),
      ]);
    });

    test("rejects a locale the site doesn't serve", async () => {
      const { preparePayStateSchema } = await import(
        "./prepare-pay-state.schema"
      );

      const result = await preparePayStateSchema["~standard"].validate(
        submissionIn("fr-FR" as Locale, "+420 777 123 456")
      );

      expect(result.issues).toBeDefined();
    });

    test.each([
      ["reservation form", {}],
      ["customer app", { serverCaller: true }],
    ] as const)(
      "looks up the Dotypos customer for a de-DE %s submission with its phone read in Germany",
      async (_caller, caller) => {
        const result = await runReusableReservationScenario({
          ...caller,
          locale: "de-DE",
          findByAttemptKeys: mock(() =>
            Effect.succeed(makeReusableReservation())
          ),
          reservation: { ...reservation, phone: "0151 23456789" },
        });

        expect(result.result.status).toBe("ready");
        expect(result.findOrCreateCustomer).toHaveBeenCalledWith(
          expect.objectContaining({ phone: "+4915123456789" }),
          { lookupFields: ["email"] }
        );
      }
    );
  });

  test("keeps rejecting the customer app's consent source from the site", async () => {
    const { preparePayStateSchema } = await import(
      "./prepare-pay-state.schema"
    );

    const result = await preparePayStateSchema["~standard"].validate({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: "advertised-price-token",
      reservation: { ...reservation, date: "2099-07-01" },
      marketingConsent: true,
      marketingConsentSource: "customer_app",
    });

    expect(result.issues).toEqual([
      expect.objectContaining({ path: ["marketingConsentSource"] }),
    ]);
  });

  test.each([
    ["absent", undefined],
    ["false", false],
  ] as const)(
    "a %s marketing choice neither grants nor withdraws consent",
    async (_label, marketingConsent) => {
      const result = await runReusableReservationScenario({
        holdForAttempt: reuseHold(makeReusableReservation()),
        marketingConsent,
      });

      expect(result.result.status).toBe("ready");
      expect(result.recordMarketingConsent).not.toHaveBeenCalled();
      expect(result.withdrawActiveMarketingConsent).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["absent", {}],
    ["false", { marketingConsent: false }],
  ] as const)(
    "rejects a marketing consent source when marketingConsent is %s",
    async (_label, marketingConsent) => {
      const { preparePayStateSchema } = await import(
        "./prepare-pay-state.schema"
      );
      const validInput = {
        locale: "en-US",
        checkoutSessionId: "session-id",
        checkoutAttemptId: "attempt-id",
        advertisedPriceToken: "advertised-price-token",
        reservation: { ...reservation, date: "2099-07-01" },
      };

      const accepted = await preparePayStateSchema["~standard"].validate({
        ...validInput,
        marketingConsent: true,
        marketingConsentSource: "site_tool",
      });
      const rejected = await preparePayStateSchema["~standard"].validate({
        ...validInput,
        ...marketingConsent,
        marketingConsentSource: "site_tool",
      });

      expect(accepted.issues).toBeUndefined();
      expect(rejected.issues).toEqual([
        expect.objectContaining({ path: ["marketingConsentSource"] }),
      ]);
    }
  );

  test("rejects a marketing consent source other than the site's tools", async () => {
    const { preparePayStateSchema } = await import(
      "./prepare-pay-state.schema"
    );

    const result = await preparePayStateSchema["~standard"].validate({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: "advertised-price-token",
      reservation: { ...reservation, date: "2099-07-01" },
      marketingConsent: true,
      marketingConsentSource: "reservation_form",
    });

    expect(result.issues).toBeDefined();
  });

  describe.skipIf(!testDatabase)("stored marketing consent", () => {
    const customerId = "customer-id";
    const earlierGrant = {
      documentHash: "earlier-marketing-hash",
      locale: "cs-CZ" as const,
      grantedAt: Temporal.Instant.from("2026-09-01T10:00:00Z"),
      grantSource: "account" as const,
    };
    const activeRow = { ...earlierGrant, withdrawnAt: null };
    const withdrawnRow = {
      ...earlierGrant,
      withdrawnAt: Temporal.Instant.from("2026-09-02T10:00:00Z"),
    };

    const runWithStoredConsent = async (
      stored: typeof activeRow | typeof withdrawnRow | null,
      input: {
        readonly marketingConsent?: boolean;
        readonly marketingConsentSource?: "site_tool" | "customer_app";
        readonly serverCaller?: boolean;
        readonly bookingAgent?: {
          readonly clientId: string;
          readonly selectionKey: string;
        };
      }
    ) => {
      const { db } = testDatabase!;
      const { MarketingConsentLedger } = await import(
        "@/features/legal/backend/marketing-consent-ledger"
      );
      await Effect.runPromise(
        db
          .delete(customerMarketingConsents)
          .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
      );
      if (stored) {
        await Effect.runPromise(
          db
            .insert(customerMarketingConsents)
            .values({ dotyposCustomerId: customerId, ...stored })
        );
      }

      const scenario = await runReusableReservationScenario({
        holdForAttempt: reuseHold(makeReusableReservation()),
        ...input,
        marketingConsentLedger: MarketingConsentLedger.Default.pipe(
          Layer.provide(
            Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db))
          )
        ),
      });
      expect(scenario.result?.status).toBe("ready");

      const [row] = await Effect.runPromise(
        db
          .select()
          .from(customerMarketingConsents)
          .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
      );
      await Effect.runPromise(
        db
          .delete(customerMarketingConsents)
          .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
      );
      return row ?? null;
    };

    const expectStoredRow = (
      row: Awaited<ReturnType<typeof runWithStoredConsent>>,
      expected: typeof activeRow | typeof withdrawnRow
    ) => {
      expect(row).not.toBeNull();
      expect(row?.documentHash).toBe(expected.documentHash);
      expect(row?.locale).toBe(expected.locale);
      expect(row?.grantSource).toBe(expected.grantSource);
      expect(row?.grantedAt.equals(expected.grantedAt)).toBe(true);
      if (expected.withdrawnAt) {
        expect(row?.withdrawnAt?.equals(expected.withdrawnAt)).toBe(true);
      } else {
        expect(row?.withdrawnAt).toBeNull();
      }
    };

    test("an absent choice writes no consent row", async () => {
      expect(await runWithStoredConsent(null, {})).toBeNull();
    });

    test("false leaves an active consent active and unchanged", async () => {
      const row = await runWithStoredConsent(activeRow, {
        marketingConsent: false,
      });
      expectStoredRow(row, activeRow);
    });

    test("false leaves a withdrawn consent unchanged", async () => {
      const row = await runWithStoredConsent(withdrawnRow, {
        marketingConsent: false,
      });
      expectStoredRow(row, withdrawnRow);
    });

    test("an opt-in through the site's tools stores site_tool as the source", async () => {
      const row = await runWithStoredConsent(null, {
        marketingConsent: true,
        marketingConsentSource: "site_tool",
      });
      expect(row?.grantSource).toBe("site_tool");
      expect(row?.withdrawnAt).toBeNull();
      expect(row?.documentHash).toBe(
        getLegalDocumentVersion("en-US", "marketing-communications")
      );
    });

    test("an opt-in from the customer's app stores customer_app as the source", async () => {
      const row = await runWithStoredConsent(null, {
        marketingConsent: true,
        marketingConsentSource: "customer_app",
        serverCaller: true,
      });
      expect(row?.grantSource).toBe("customer_app");
      expect(row?.withdrawnAt).toBeNull();
    });

    test("a form opt-in stores reservation_form as the source", async () => {
      const row = await runWithStoredConsent(null, { marketingConsent: true });
      expect(row?.grantSource).toBe("reservation_form");
      expect(row?.withdrawnAt).toBeNull();
      expect(row?.documentHash).toBe(
        getLegalDocumentVersion("en-US", "marketing-communications")
      );
    });

    const bookingAgent = {
      clientId: "https://assistant.example/oauth-client.json",
      selectionKey: "stored-consent-agent-selection",
    };

    test("an agent's opt-in stores mcp_tool as the source", async () => {
      const row = await runWithStoredConsent(null, {
        marketingConsent: true,
        bookingAgent,
      });
      expect(row?.grantSource).toBe("mcp_tool");
      expect(row?.withdrawnAt).toBeNull();
      expect(row?.documentHash).toBe(
        getLegalDocumentVersion("en-US", "marketing-communications")
      );
    });

    test("an agent's absent choice writes no consent row", async () => {
      expect(await runWithStoredConsent(null, { bookingAgent })).toBeNull();
    });

    test("an agent's false leaves an active consent active and unchanged", async () => {
      const row = await runWithStoredConsent(activeRow, {
        marketingConsent: false,
        bookingAgent,
      });
      expectStoredRow(row, activeRow);
    });

    test("an opt-in does not reactivate a withdrawn consent", async () => {
      const row = await runWithStoredConsent(withdrawnRow, {
        marketingConsent: true,
        marketingConsentSource: "site_tool",
      });
      expectStoredRow(row, withdrawnRow);
    });
  });

  test("fails checkout when an explicit marketing opt-in cannot be stored", async () => {
    const persistenceFailure = new EffectDrizzleQueryError({
      query: "customer marketing consent grant",
      params: [],
      cause: new Error("database unavailable"),
    });

    const { error } = await runReusableReservationScenario({
      holdForAttempt: reuseHold(makeReusableReservation()),
      marketingConsent: true,
      recordMarketingConsent: mock(() => Effect.fail(persistenceFailure)),
    });

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      cause: persistenceFailure,
    });
  });

  test("holds the account advisory lock across reservation state creation", async () => {
    const lockProbe = { held: false };
    const lockSamples: boolean[] = [];
    const scenario = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      createDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            id: "locked-reservation-id",
            authorAccountId: input.authorAccountId,
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            correlationId: "locked-correlation-id",
            dotyposCustomerId: input.dotyposCustomerId,
            reservationDetails: input.reservationDetails,
            locale: input.locale,
            reservationHoldExpiresAt: input.reservationHoldExpiresAt,
          })
        )
      ),
      findOrCreateCustomer: mock(() => {
        lockSamples.push(lockProbe.held);
        return Effect.succeed({ id: "customer-id" });
      }),
      accountAuthority: { session: {}, activityState: "active", lockProbe },
    });

    expect(scenario.result?.status).toBe("ready");
    expect(lockSamples).toEqual([true]);
  });

  test("stops preparation when the account session authority cannot be read", async () => {
    const { m } = await import("@/features/i18n");
    const scenario = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      accountAuthority: { sessionUnavailable: true },
    });

    expect(scenario.result).toBeUndefined();
    expect(scenario.error).toMatchObject({
      _tag: "PublicSafeActionError",
      message: m.reservationErrorMessage({}, { locale: "en-US" }),
      cause: {
        _tag: "CustomerAccountAccessError",
        reason: "unavailable",
      },
    });
    expect(scenario.guardEvents).toEqual([]);
    expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
    expect(scenario.createDraft).not.toHaveBeenCalled();
    expect(scenario.recordMarketingConsent).not.toHaveBeenCalled();
  });

  test("stops a deletion-marked authenticated preparation before any mutation", async () => {
    const { m } = await import("@/features/i18n");
    const scenario = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      accountAuthority: {
        session: { deletionRequested: true },
        activityState: "deletion-requested",
      },
    });

    expect(scenario.result).toBeUndefined();
    expect(scenario.error).toMatchObject({
      _tag: "PublicSafeActionError",
      message: m.accountDeletionPendingError({}, { locale: "en-US" }),
      cause: {
        _tag: "CustomerAccountAccessError",
        reason: "link-required",
        linkReason: "deletion-requested",
      },
    });
    expect(scenario.guardEvents).toEqual([
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "account-lock-released",
    ]);
    expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
    expect(scenario.createDraft).not.toHaveBeenCalled();
    expect(scenario.recordMarketingConsent).not.toHaveBeenCalled();
  });

  test("stops preparation when the account row disappears during the authority window", async () => {
    const { m } = await import("@/features/i18n");
    const scenario = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      accountAuthority: { session: {}, activityState: "missing" },
    });

    expect(scenario.result).toBeUndefined();
    expect(scenario.error).toMatchObject({
      _tag: "PublicSafeActionError",
      message: m.accountSessionExpired({}, { locale: "en-US" }),
      cause: {
        _tag: "CustomerAccountAccessError",
        reason: "unauthenticated",
      },
    });
    expect(scenario.guardEvents).toEqual([
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "account-lock-released",
    ]);
    expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
    expect(scenario.createDraft).not.toHaveBeenCalled();
  });

  describe("without a signed-in account", () => {
    test.each([
      ["an anonymous session", { session: null }],
      [
        "customer accounts not configured",
        { authenticationNotConfigured: true },
      ],
    ] as const)(
      "rejects %s with the expired-session message before creating any state",
      async (_label, accountAuthority) => {
        const { m } = await import("@/features/i18n");
        for (const customer of [undefined, "account" as const]) {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() =>
              Effect.die("no checkout attempt may be read")
            ),
            createDraft: mock(() => Effect.die("no draft may be created")),
            accountAuthority,
            customer,
            marketingConsent: true,
            rememberedReferralCode: "RFL12345",
            findAvailableCode: mock(() => Effect.succeed(undefined)),
          });

          expect(scenario.result).toBeUndefined();
          expect(scenario.error).toMatchObject({
            _tag: "PublicSafeActionError",
            message: m.accountSessionExpired({}, { locale: "en-US" }),
            cause: {
              _tag: "CustomerAccountAccessError",
              reason: "unauthenticated",
            },
          });
          expect(scenario.guardEvents).toEqual([]);
          expect(scenario.peekStanding).not.toHaveBeenCalled();
          expect(scenario.completeProfile).not.toHaveBeenCalled();
          expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
          expect(scenario.quoteForCustomer).not.toHaveBeenCalled();
          expect(scenario.recordMarketingConsent).not.toHaveBeenCalled();
          expect(scenario.createDraft).not.toHaveBeenCalled();
          expect(scenario.createReservation).not.toHaveBeenCalled();
          expect(scenario.enqueueCleanup).not.toHaveBeenCalled();
          expect(scenario.evaluateCheckoutReferral).not.toHaveBeenCalled();
          expect(scenario.rememberedReferralCodeAfter).toBe("RFL12345");
        }
      }
    );
  });

  describe("booking as the signed-in account", () => {
    const accountId = "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01";
    const accountDotyposCustomerId = "60111";
    const linkedAccountState = () =>
      Effect.succeed({
        status: "linked",
        accountId,
        dotyposCustomerId: accountDotyposCustomerId,
        email: testEmailAddressForGrace,
      } as never);
    const accountContact = (
      overrides: {
        readonly dotyposCustomerId?: string;
        readonly phone?: string | null;
      } = {}
    ) =>
      Effect.succeed({
        accountId,
        dotyposCustomerId: accountDotyposCustomerId,
        name: "Grace Hopper",
        email: testEmailAddressForGrace,
        phone: "+420 602 123 456",
        ...overrides,
      } as never);
    /** An account booking for the signed-in account's linked profile. */
    const linkedAccountBooking = () => ({
      customer: "account" as const,
      account: linkedAccountState(),
      linkedContact: mock(() => accountContact()),
    });
    const createFreshDraft = () =>
      mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            id: "account-reservation-id",
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            correlationId: "account-correlation-id",
            dotyposCustomerId: input.dotyposCustomerId,
            reservationDetails: input.reservationDetails,
            locale: input.locale,
            reservationHoldExpiresAt: input.reservationHoldExpiresAt,
          })
        )
      );

    // An account without a profile saves the contact and billing it books
    // with as its first profile, creating its Dotypos customer.
    const createdCustomerId = "60222";
    const unlinkedAccountState = () =>
      Effect.succeed({
        status: "unlinked",
        accountId,
        email: testEmailAddressForGrace,
      } as never);
    const profileCompletion = () =>
      mock(() => accountContact({ dotyposCustomerId: createdCustomerId }));
    const billingAddress = {
      line1: "Karlova 1",
      city: "Praha",
      postalCode: "110 00",
      country: "CZ",
    };

    describe("through a customer agent", () => {
      const bookingAgent = {
        clientId: "https://assistant.example/oauth-client.json",
        selectionKey: "agent-selection-key",
      };
      const agentReservation = { ...reservation, date: "2026-10-22" };
      const agentBooking = () => ({
        ...linkedAccountBooking(),
        bookingAgent,
      });
      const agentHold = (overrides: Partial<WorkspaceReservationRow> = {}) =>
        makeReusableReservation({
          authorAccountId: accountId as never,
          agentClientId: bookingAgent.clientId,
          ...overrides,
        });
      const runAgentAt = async (
        now: Temporal.Instant,
        overrides: Omit<
          Parameters<typeof runReusableReservationScenario>[0],
          "bookingAgent" | "reservation" | "now" | "advertisedPriceToken"
        >
      ) => {
        setSystemTime(new Date(now.toString()));
        const advertisedPriceToken = await buildAdvertisedPriceToken(
          buildCoworkReservationQuote(agentReservation),
          undefined,
          "en-US",
          undefined,
          now,
          agentReservation
        );
        return runReusableReservationScenario({
          ...agentBooking(),
          reservation: agentReservation,
          now,
          advertisedPriceToken,
          ...overrides,
        });
      };
      const makeAgentDraft = (id: string) =>
        mock((input) =>
          Effect.succeed(
            makeReusableReservation({
              id,
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
              correlationId: `${id}-correlation`,
              dotyposCustomerId: input.dotyposCustomerId,
              reservationDetails: input.reservationDetails,
              locale: input.locale,
              reservationHoldExpiresAt: input.reservationHoldExpiresAt,
              authorAccountId: input.authorAccountId,
              agentClientId: input.agentClientId,
              agentSelectionKey: input.agentSelectionKey,
              reservationState: "draft",
              paymentState: "not_started",
              dotyposReservationId: null,
            })
          )
        );
      const makeAgentHoldFromDraft = (
        id: string,
        input: CreateWorkspaceReservationDraftInput,
        bookedAt: Temporal.Instant,
        overrides: Partial<WorkspaceReservationRow> = {}
      ) =>
        agentHold({
          id,
          checkoutSessionKey: input.checkoutSessionKey,
          checkoutAttemptKey: input.checkoutAttemptKey,
          correlationId: `${id}-correlation`,
          dotyposCustomerId: input.dotyposCustomerId,
          dotyposReservationId: "dotypos-reservation-id",
          authorAccountId: accountId as never,
          agentClientId: bookingAgent.clientId,
          agentSelectionKey: input.agentSelectionKey,
          reservationDetails: input.reservationDetails,
          locale: input.locale,
          reservationHoldExpiresAt: input.reservationHoldExpiresAt,
          reservationCreatedAt: bookedAt,
          createdAt: bookedAt,
          ...overrides,
        });
      const makeInitialAgentHold = async () => {
        const bookedAt = Temporal.Instant.from("2026-10-20T12:09:59Z");
        const createDraft = makeAgentDraft("agent-live-hold-id");
        const createReservation = mock(() =>
          Effect.succeed({ id: "dotypos-live-hold-id" } as never)
        );
        const cancelReservation = mock(() => Effect.void);
        const claimSupersessionCancellation = mock(() => Effect.succeed(null));
        const first = await runAgentAt(bookedAt, {
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft,
          createReservation,
          cancelReservation,
          claimSupersessionCancellation,
        });
        const draftInput = createDraft.mock.calls[0]?.[0];
        expect(first.result?.status).toBe("ready");
        expect(draftInput?.reservationHoldExpiresAt?.toString()).toBe(
          "2026-10-20T12:19:59Z"
        );
        expect(draftInput?.agentSelectionKey).toBe(bookingAgent.selectionKey);
        const held = makeAgentHoldFromDraft(
          "agent-live-hold-id",
          draftInput!,
          bookedAt
        );
        return {
          first,
          held,
          createDraft,
          createReservation,
          cancelReservation,
          claimSupersessionCancellation,
        };
      };
      const runLiveHoldRetry = async (retryAt: Temporal.Instant) => {
        const initial = await makeInitialAgentHold();
        const retry = await runAgentAt(retryAt, {
          findLatestByAgentSelectionKey: mock(() =>
            Effect.succeed([initial.held])
          ),
          findByAttemptKeys: mock((keys: readonly string[]) =>
            Effect.succeed(
              keys.includes(initial.held.checkoutAttemptKey)
                ? initial.held
                : null
            )
          ),
          createDraft: initial.createDraft,
          createReservation: initial.createReservation,
          cancelReservation: initial.cancelReservation,
          claimSupersessionCancellation: initial.claimSupersessionCancellation,
        });

        expect(retry.result?.orderId).toBe(initial.first.result?.orderId);
        expect(retry.result?.redirectUrl).toBe(
          initial.first.result?.redirectUrl
        );
        expect(retry.result?.expiresAt).toBe(initial.first.result?.expiresAt);
        expect(initial.createReservation).toHaveBeenCalledTimes(1);
        expect(initial.cancelReservation).not.toHaveBeenCalled();
        expect(initial.createDraft).toHaveBeenCalledTimes(1);
        expect(initial.claimSupersessionCancellation).not.toHaveBeenCalled();
        return { initial, retry };
      };

      test("books without BotID and records the agent client on the new hold", async () => {
        const scenario = await runReusableReservationScenario({
          ...agentBooking(),
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
        });

        expect(scenario.result).toMatchObject({
          status: "ready",
          orderId: "account-reservation-id",
        });
        expect(scenario.verifyHuman).not.toHaveBeenCalled();
        expect(scenario.createDraft.mock.calls[0]?.[0]).toMatchObject({
          authorAccountId: accountId,
          agentClientId: bookingAgent.clientId,
        });
      });

      test("keeps the form's drafts free of an agent client", async () => {
        const scenario = await runReusableReservationScenario({
          ...linkedAccountBooking(),
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
        });

        expect(scenario.verifyHuman).toHaveBeenCalledTimes(1);
        expect(scenario.createDraft.mock.calls[0]?.[0]).not.toHaveProperty(
          "agentClientId"
        );
      });

      test.each([
        ["the live hold it settles into", "settled"],
        ["the latest row when it disappears", "gone"],
      ] as const)(
        "waits out the latest hold's in-flight creation, then resumes %s",
        async (_label, settlement) => {
          const initial = await makeInitialAgentHold();
          const findById = mock(() =>
            Effect.succeed(settlement === "settled" ? initial.held : null)
          );
          const retry = await runAgentAt(
            Temporal.Instant.from("2026-10-20T12:12:00Z"),
            {
              findLatestByAgentSelectionKey: mock(() =>
                Effect.succeed([
                  { ...initial.held, reservationState: "creating_hold" },
                ])
              ),
              findById,
              findByAttemptKeys: mock((keys: readonly string[]) =>
                Effect.succeed(
                  keys.includes(initial.held.checkoutAttemptKey)
                    ? initial.held
                    : null
                )
              ),
              createDraft: initial.createDraft,
              createReservation: initial.createReservation,
              claimSupersessionCancellation:
                initial.claimSupersessionCancellation,
            }
          );

          expect(findById).toHaveBeenCalledWith(initial.held.id);
          expect(retry.result?.orderId).toBe(initial.held.id);
          expect(initial.createReservation).toHaveBeenCalledTimes(1);
          expect(initial.createDraft).toHaveBeenCalledTimes(1);
          expect(initial.claimSupersessionCancellation).not.toHaveBeenCalled();
        }
      );

      test("reuses the live hold when an identical request repeats across the old 10-minute boundary", async () => {
        const { initial, retry } = await runLiveHoldRetry(
          Temporal.Instant.from("2026-10-20T12:10:01Z")
        );

        expect(initial.first.result?.orderId).toBe("agent-live-hold-id");
        expect(retry.result?.orderId).toBe("agent-live-hold-id");
      });

      test("returns a byte-identical Pay URL for a same-time identical retry", async () => {
        const { initial, retry } = await runLiveHoldRetry(
          Temporal.Instant.from("2026-10-20T12:09:59Z")
        );

        expect(retry.result?.redirectUrl).toBe(
          initial.first.result?.redirectUrl
        );
      });

      test("keeps a booking whose payment is pending", async () => {
        const initial = await makeInitialAgentHold();
        const pending = agentHold({
          ...initial.held,
          paymentState: "pending",
          activePaymentAttemptId: "pending-payment-attempt-id" as never,
        });
        const claimHoldCreation = mock(() =>
          Effect.die("a pending retry must not claim hold creation")
        );
        const claimSupersessionCancellation = mock(() =>
          Effect.die("a pending retry must not cancel its hold")
        );
        const retry = await runAgentAt(
          Temporal.Instant.from("2026-10-20T12:15:00Z"),
          {
            findLatestByAgentSelectionKey: mock(() =>
              Effect.succeed([pending])
            ),
            findByAttemptKeys: mock(() =>
              Effect.die("a pending retry must not look up another attempt")
            ),
            createDraft: initial.createDraft,
            claimHoldCreation,
            claimSupersessionCancellation,
            createReservation: initial.createReservation,
            cancelReservation: initial.cancelReservation,
          }
        );

        expect(retry.result?.orderId).toBe(initial.first.result?.orderId);
        expect(retry.result?.redirectUrl).toBe(
          initial.first.result?.redirectUrl
        );
        expect(retry.result?.expiresAt).toBe(initial.first.result?.expiresAt);
        expect(initial.createReservation).toHaveBeenCalledTimes(1);
        expect(initial.cancelReservation).not.toHaveBeenCalled();
        expect(initial.createDraft).toHaveBeenCalledTimes(1);
        expect(claimHoldCreation).not.toHaveBeenCalled();
        expect(claimSupersessionCancellation).not.toHaveBeenCalled();
      });

      test("refuses a repeat once a pending booking's Pay link expired", async () => {
        const pending = agentHold({
          id: "expired-pending-agent-hold-id",
          reservationHoldExpiresAt: Temporal.Instant.from(
            "2026-10-20T12:19:59Z"
          ),
          reservationCreatedAt: Temporal.Instant.from("2026-10-20T12:09:59Z"),
          paymentState: "pending",
          activePaymentAttemptId: "pending-payment-attempt-id" as never,
        });
        const createReservation = mock(() =>
          Effect.succeed({ id: "unexpected-dotypos-hold-id" } as never)
        );
        const cancelReservation = mock(() => Effect.void);
        const scenario = await runAgentAt(
          Temporal.Instant.from("2026-10-20T12:20:30Z"),
          {
            findLatestByAgentSelectionKey: mock(() =>
              Effect.succeed([pending])
            ),
            findByAttemptKeys: mock(() => Effect.die("no attempt lookup")),
            createReservation,
            cancelReservation,
          }
        );

        expect(scenario.error).toMatchObject({
          _tag: "AgentBookingPaymentInProgressError",
        });
        expect(createReservation).not.toHaveBeenCalled();
        expect(cancelReservation).not.toHaveBeenCalled();
        expect(scenario.createDraft).not.toHaveBeenCalled();
      });

      test("refuses an identical request whose live hold sits in a rotated session after the profile changed", async () => {
        const rotatedHold = agentHold({
          id: "rotated-agent-hold-id",
          checkoutSessionKey: "rotated-session-key" as never,
          checkoutAttemptKey: "stale-attempt-key" as never,
          reservationHoldExpiresAt: Temporal.Instant.from(
            "2026-10-20T12:19:59Z"
          ),
          reservationCreatedAt: Temporal.Instant.from("2026-10-20T12:09:59Z"),
          reservationState: "held",
          paymentState: "not_started",
          dotyposReservationId: "rotated-dotypos-reservation-id",
        });
        const createReservation = mock(() =>
          Effect.succeed({ id: "unexpected-dotypos-hold-id" } as never)
        );
        const cancelReservation = mock(() => Effect.void);
        const claimSupersessionCancellation = mock(() =>
          Effect.succeed(rotatedHold)
        );
        const scenario = await runAgentAt(
          Temporal.Instant.from("2026-10-20T12:15:00Z"),
          {
            findLatestByAgentSelectionKey: mock(() =>
              Effect.succeed([rotatedHold])
            ),
            findByAttemptKeys: mock(() => Effect.die("no attempt lookup")),
            createReservation,
            cancelReservation,
            claimSupersessionCancellation,
          }
        );

        expect(scenario.error).toMatchObject({
          _tag: "CheckoutAttemptUnavailableError",
        });
        expect(createReservation).not.toHaveBeenCalled();
        expect(cancelReservation).not.toHaveBeenCalled();
        expect(scenario.createDraft).not.toHaveBeenCalled();
        expect(claimSupersessionCancellation).not.toHaveBeenCalled();
      });

      test("starts a new hold for an identical request after the hold expired", async () => {
        const initial = await makeInitialAgentHold();
        const replacementId = "agent-after-expiry-hold-id";
        const createReservation = mock(() =>
          Effect.succeed({ id: "dotypos-after-expiry-hold-id" } as never)
        );
        const cancelReservation = mock(() => Effect.void);
        const claimSupersessionCancellation = mock(() =>
          Effect.succeed(initial.held)
        );
        const completeSupersessionAndCreateDraft = mock((input) =>
          Effect.succeed(
            agentHold({
              id: replacementId,
              checkoutSessionKey: input.replacement.checkoutSessionKey,
              checkoutAttemptKey: input.replacement.checkoutAttemptKey,
              correlationId: `${replacementId}-correlation`,
              dotyposCustomerId: input.replacement.dotyposCustomerId,
              reservationDetails: input.replacement.reservationDetails,
              locale: input.replacement.locale,
              reservationHoldExpiresAt:
                input.replacement.reservationHoldExpiresAt,
              agentSelectionKey: input.replacement.agentSelectionKey,
              dotyposReservationId: null,
              reservationState: "draft",
              paymentState: "not_started",
            })
          )
        );
        const scenario = await runAgentAt(
          Temporal.Instant.from("2026-10-20T12:25:00Z"),
          {
            findLatestByAgentSelectionKey: mock(() =>
              Effect.succeed([initial.held])
            ),
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            findCurrentByCheckoutSessionKey: mock(() =>
              Effect.succeed(initial.held)
            ),
            getReservationStatus: mock(() => Effect.succeed("NEW" as const)),
            claimSupersessionCancellation,
            completeSupersessionAndCreateDraft,
            createReservation,
            cancelReservation,
          }
        );
        const replacementAttemptKey =
          completeSupersessionAndCreateDraft.mock.calls[0]?.[0].replacement
            .checkoutAttemptKey;

        expect(scenario.result?.orderId).toBe(replacementId);
        expect(scenario.result?.orderId).not.toBe(initial.held.id);
        expect(createReservation).toHaveBeenCalledTimes(1);
        expect(replacementAttemptKey).not.toBe(initial.held.checkoutAttemptKey);
      });

      test("never supersedes a reservation another account authored in the session", async () => {
        const scenario = await runReusableReservationScenario({
          ...agentBooking(),
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          // The rotated session the submission moves to has no reservation.
          findCurrentByCheckoutSessionKey: mock()
            .mockReturnValueOnce(
              Effect.succeed(
                makeReusableReservation({
                  id: "someone-elses-hold-id",
                  authorAccountId: "another-account" as never,
                })
              )
            )
            .mockReturnValue(Effect.succeed(null)),
          createDraft: createFreshDraft(),
        });

        expect(scenario.result?.status).toBe("ready");
        expect(scenario.claimSupersessionCancellation).not.toHaveBeenCalled();
        expect(scenario.cancelReservation).not.toHaveBeenCalled();
        expect(scenario.createDraft).toHaveBeenCalledTimes(1);
      });

      describe("once the agent session holds a paid booking", () => {
        const paidBooking = agentHold({
          id: "paid-agent-booking-id",
          reservationState: "confirmed",
          paymentState: "paid",
          paidAt: Temporal.Instant.from("2026-07-01T10:00:00Z"),
        });
        const rotatedHold = agentHold({
          id: "rotated-agent-hold-id",
          checkoutSessionKey: "rotated-session-key" as never,
          dotyposReservationId: "rotated-dotypos-reservation-id",
        });
        // The paid booking stays the agent session's reservation, so a new
        // selection rotates into a session that has none.
        const paidAgentSession = () =>
          mock()
            .mockReturnValueOnce(Effect.succeed(paidBooking))
            .mockReturnValue(Effect.succeed(null));

        test("keeps a rotated hold whose payment started before it was claimed", async () => {
          const scenario = await runReusableReservationScenario({
            ...agentBooking(),
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            findCurrentByCheckoutSessionKey: paidAgentSession(),
            findSupersedableByAgentClient: mock(() =>
              Effect.succeed([rotatedHold])
            ),
            // The claim only takes a hold with no payment pending or made.
            claimSupersessionCancellation: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
          });

          expect(scenario.result?.status).toBe("ready");
          expect(scenario.getReservationStatus).not.toHaveBeenCalled();
          expect(scenario.cancelReservation).not.toHaveBeenCalled();
          expect(scenario.markCancelled).not.toHaveBeenCalled();
          expect(scenario.createDraft).toHaveBeenCalledTimes(1);
        });

        test("reuses the hold of an identical retry in its rotated session without superseding it", async () => {
          const bookedAt = Temporal.Instant.from("2026-10-20T12:09:59Z");
          const createDraft = makeAgentDraft("rotated-live-hold-id");
          const createReservation = mock(() =>
            Effect.succeed({ id: "dotypos-rotated-live-hold-id" } as never)
          );
          const firstAgentSession = paidAgentSession();
          const first = await runAgentAt(bookedAt, {
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            findCurrentByCheckoutSessionKey: firstAgentSession,
            createDraft,
            createReservation,
          });
          const held = makeAgentHoldFromDraft(
            "rotated-live-hold-id",
            createDraft.mock.calls[0]![0],
            bookedAt
          );
          const claimSupersessionCancellation = mock(() =>
            Effect.die("an identical retry must not cancel its own hold")
          );
          const cancelReservation = mock(() => Effect.void);
          const retry = await runAgentAt(
            Temporal.Instant.from("2026-10-20T12:12:00Z"),
            {
              findLatestByAgentSelectionKey: mock(() => Effect.succeed([held])),
              findByAttemptKeys: mock((keys: readonly string[]) =>
                Effect.succeed(
                  keys.includes(held.checkoutAttemptKey) ? held : null
                )
              ),
              findCurrentByCheckoutSessionKey: paidAgentSession(),
              findSupersedableByAgentClient: mock(() => Effect.succeed([held])),
              claimSupersessionCancellation,
              cancelReservation,
              createDraft,
              createReservation,
            }
          );

          expect(first.result?.status).toBe("ready");
          // The hold sits in a session rotated past the agent session's
          // paid booking.
          expect(held.checkoutSessionKey).not.toBe(
            firstAgentSession.mock.calls[0]?.[0]
          );
          expect(retry.result?.orderId).toBe("rotated-live-hold-id");
          expect(retry.result?.redirectUrl).toBe(first.result?.redirectUrl);
          expect(claimSupersessionCancellation).not.toHaveBeenCalled();
          expect(cancelReservation).not.toHaveBeenCalled();
          expect(createDraft).toHaveBeenCalledTimes(1);
          expect(createReservation).toHaveBeenCalledTimes(1);
        });
      });

      test("leaves the agent session's own hold to the session's supersession", async () => {
        const { held } = await makeInitialAgentHold();
        const claimSupersessionCancellation = mock(() => Effect.succeed(held));
        const scenario = await runAgentAt(
          Temporal.Instant.from("2026-10-20T12:12:00Z"),
          {
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(held)),
            findSupersedableByAgentClient: mock(() => Effect.succeed([held])),
            claimSupersessionCancellation,
            completeSupersessionAndCreateDraft: mock((input) =>
              Effect.succeed(
                agentHold({
                  id: "replacement-agent-hold-id",
                  checkoutSessionKey: input.replacement.checkoutSessionKey,
                  checkoutAttemptKey: input.replacement.checkoutAttemptKey,
                  dotyposReservationId: null,
                  reservationState: "draft",
                })
              )
            ),
          }
        );

        expect(scenario.result?.orderId).toBe("replacement-agent-hold-id");
        expect(claimSupersessionCancellation).toHaveBeenCalledTimes(1);
        expect(scenario.cancelReservation).toHaveBeenCalledTimes(1);
        expect(scenario.markCancelled).not.toHaveBeenCalled();
      });

      test("labels the customer's marketing opt-in with the MCP channel", async () => {
        const scenario = await runReusableReservationScenario({
          ...agentBooking(),
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          marketingConsent: true,
        });

        expect(
          scenario.recordMarketingConsent.mock.calls[0]?.[0]
        ).toMatchObject({
          customerId: accountDotyposCustomerId,
          choice: "grant",
          mode: "initial",
          channel: "mcp_tool",
        });
      });

      test.each([
        ["absent", undefined],
        ["false", false],
      ] as const)(
        "records and withdraws nothing for an %s marketing choice",
        async (_, marketingConsent) => {
          const scenario = await runReusableReservationScenario({
            ...agentBooking(),
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            marketingConsent,
          });

          expect(scenario.result?.status).toBe("ready");
          expect(scenario.recordMarketingConsent).not.toHaveBeenCalled();
          expect(
            scenario.withdrawActiveMarketingConsent
          ).not.toHaveBeenCalled();
        }
      );

      test("asks an account without a profile to finish it on the site", async () => {
        const scenario = await runReusableReservationScenario({
          bookingAgent,
          customer: "account",
          account: unlinkedAccountState(),
          completeProfile: profileCompletion(),
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
        });

        expect(scenario.error).toMatchObject({
          _tag: "AgentBookingProfileRequiredError",
        });
        expect(scenario.completeProfile).not.toHaveBeenCalled();
        expect(scenario.createDraft).not.toHaveBeenCalled();
      });

      test("asks a profile without a phone number to be finished on the site", async () => {
        const scenario = await runReusableReservationScenario({
          ...agentBooking(),
          linkedContact: mock(() => accountContact({ phone: null })),
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
        });

        expect(scenario.error).toMatchObject({
          _tag: "AgentBookingProfileRequiredError",
        });
        expect(scenario.createDraft).not.toHaveBeenCalled();
      });
    });

    test("books under the linked Dotypos customer without resolving one from the contact", async () => {
      const lockProbe = { held: false };
      const lockSamples: boolean[] = [];
      const linkedContact = mock(() => accountContact());
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: createFreshDraft(),
        accountAuthority: { session: {}, activityState: "active", lockProbe },
        customer: "account",
        account: Effect.suspend(() => {
          lockSamples.push(lockProbe.held);
          return linkedAccountState();
        }),
        linkedContact,
      });

      expect(scenario.result?.status).toBe("ready");
      expect(scenario.peekStanding).toHaveBeenCalledTimes(1);
      expect(lockSamples).toEqual([true]);
      expect(linkedContact.mock.calls[0]?.[0]).toMatchObject({
        accountId,
        dotyposCustomerId: accountDotyposCustomerId,
      });
      expect(scenario.completeProfile).not.toHaveBeenCalled();
      expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
      expect(scenario.createDraft).toHaveBeenCalledTimes(1);
      expect(scenario.createDraft.mock.calls[0]?.[0]).toMatchObject({
        dotyposCustomerId: accountDotyposCustomerId,
      });
      expect(scenario.quoteForCustomer.mock.calls[0]?.[0]).toMatchObject({
        dotyposCustomerId: accountDotyposCustomerId,
      });
    });

    test.each([
      ["no invoice", { purpose: "personal", invoice: "none" }, undefined],
      [
        "a personal invoice",
        { purpose: "personal", invoice: "requested", address: billingAddress },
        {
          kind: "personal",
          addressLine1: "Karlova 1",
          city: "Praha",
          zip: "110 00",
          country: "CZ",
        },
      ],
      [
        "a business invoice",
        {
          purpose: "business",
          invoice: "required",
          buyer: {
            kind: "business",
            legalName: "Hopper Computing s.r.o.",
            companyId: "12345678",
            vatId: "CZ12345678",
            address: { ...billingAddress, line2: "Floor 2" },
          },
        },
        {
          kind: "business",
          companyName: "Hopper Computing s.r.o.",
          companyId: "12345678",
          vatId: "CZ12345678",
          addressLine1: "Karlova 1",
          addressLine2: "Floor 2",
          city: "Praha",
          zip: "110 00",
          country: "CZ",
        },
      ],
    ] as const)(
      "saves the first profile with %s under the held lock and books as its new customer",
      async (_label, billing, profileBilling) => {
        const lockProbe = { held: false };
        const lockSamples: boolean[] = [];
        const completeProfile = mock(() =>
          Effect.suspend(() => {
            lockSamples.push(lockProbe.held);
            return accountContact({ dotyposCustomerId: createdCustomerId });
          })
        );
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          accountAuthority: { session: {}, activityState: "active", lockProbe },
          reservation: {
            ...reservation,
            name: "Grace Hopper",
            email: testEmailAddressForGrace,
            phone: "+420 602 123 456",
            billing,
          },
          customer: "account",
          account: unlinkedAccountState(),
          completeProfile,
        });

        expect(scenario.error).toBeUndefined();
        expect(scenario.result?.status).toBe("ready");
        expect(lockSamples).toEqual([true]);
        expect(completeProfile.mock.calls).toEqual([
          [
            expect.objectContaining({
              accountId,
              email: testEmailAddressForGrace,
            }),
            {
              firstName: "Grace",
              lastName: "Hopper",
              phone: "+420602123456",
              ...(profileBilling && { billing: profileBilling }),
            },
          ],
        ]);
        expect(scenario.linkedContact).not.toHaveBeenCalled();
        expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
        expect(scenario.quoteForCustomer.mock.calls[0]?.[0]).toMatchObject({
          dotyposCustomerId: createdCustomerId,
        });
        expect(scenario.createDraft).toHaveBeenCalledTimes(1);
        expect(scenario.createDraft.mock.calls[0]?.[0]).toMatchObject({
          dotyposCustomerId: createdCustomerId,
          authorAccountId: accountId,
        });
      }
    );

    test("saves a de-DE booking's first profile with its phone read in Germany", async () => {
      const completeProfile = mock(() =>
        accountContact({ dotyposCustomerId: createdCustomerId })
      );
      const scenario = await runReusableReservationScenario({
        locale: "de-DE",
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: createFreshDraft(),
        accountAuthority: { session: {}, activityState: "active" },
        reservation: {
          ...reservation,
          name: "Grace Hopper",
          email: testEmailAddressForGrace,
          phone: "0151 23456789",
        },
        customer: "account",
        account: unlinkedAccountState(),
        completeProfile,
      });

      expect(scenario.error).toBeUndefined();
      expect(completeProfile.mock.calls[0]?.[1]).toMatchObject({
        phone: "+4915123456789",
      });
    });

    test.each([
      ["an account booking", () => linkedAccountBooking()],
      ["a signed-in contact booking", () => ({})],
    ] as const)(
      "records the signed-in account as the author of %s",
      async (_label, booking) => {
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          ...booking(),
        });

        expect(scenario.result?.status).toBe("ready");
        expect(scenario.createDraft).toHaveBeenCalledTimes(1);
        expect(scenario.createDraft.mock.calls[0]?.[0]).toMatchObject({
          authorAccountId: accountId,
        });
      }
    );

    test("does not resume a guest's draft for an anonymous session", async () => {
      const scenario = await runReusableReservationScenario({
        holdForAttempt: mock(() => Effect.die("no hold may be acquired")),
        accountAuthority: { session: null },
      });

      expect(scenario.error).toMatchObject({
        _tag: "PublicSafeActionError",
        cause: {
          _tag: "CustomerAccountAccessError",
          reason: "unauthenticated",
        },
      });
      expect(scenario.holdForAttempt).not.toHaveBeenCalled();
    });

    test("prices the reservation with the account contact instead of the submitted one", async () => {
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: createFreshDraft(),
        reservation: {
          ...reservation,
          name: "Someone Else",
          email: testEmailAddress("someone.else"),
          phone: "+420 777 777 777",
        },
        ...linkedAccountBooking(),
      });

      expect(scenario.result?.status).toBe("ready");
      expect(
        scenario.quoteForCustomer.mock.calls[0]?.[0].reservation
      ).toMatchObject({
        name: "Grace Hopper",
        email: testEmailAddressForGrace,
        phone: "+420 602 123 456",
      });
    });

    test.each([
      [
        "the session ends before the account is read",
        () => ({ account: Effect.succeed({ status: "signed-out" } as never) }),
      ],
      [
        "the linked profile has no name to book with",
        () => ({
          account: linkedAccountState(),
          linkedContact: mock(() => Effect.succeed(null)),
        }),
      ],
      [
        "the saved first profile has no name to book with",
        () => ({
          account: unlinkedAccountState(),
          completeProfile: mock(() => Effect.succeed(null)),
        }),
      ],
    ] as const)(
      "reports an expired session when %s",
      async (_label, account) => {
        const { m } = await import("@/features/i18n");
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          customer: "account",
          ...account(),
        });

        expect(scenario.result).toBeUndefined();
        expect(scenario.error).toMatchObject({
          _tag: "PublicSafeActionError",
          message: m.accountSessionExpired({}, { locale: "en-US" }),
          cause: {
            _tag: "CustomerAccountAccessError",
            reason: "unauthenticated",
          },
        });
        expect(scenario.peekStanding).toHaveBeenCalledTimes(1);
        expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
        expect(scenario.quoteForCustomer).not.toHaveBeenCalled();
        expect(scenario.createDraft).not.toHaveBeenCalled();
      }
    );

    test.each([
      [
        "the account cannot be read",
        () => ({
          account: Effect.fail(
            new CustomerAccountAccessError({ reason: "unavailable" })
          ),
        }),
      ],
      [
        "the first profile cannot be saved",
        () => ({
          account: unlinkedAccountState(),
          completeProfile: mock(() =>
            Effect.fail(
              new CustomerAccountAccessError({ reason: "unavailable" })
            )
          ),
        }),
      ],
    ] as const)(
      "reports a generic reservation error when %s",
      async (_label, account) => {
        const { m } = await import("@/features/i18n");
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          customer: "account",
          ...account(),
        });

        expect(scenario.error).toMatchObject({
          _tag: "PublicSafeActionError",
          message: m.reservationErrorMessage({}, { locale: "en-US" }),
          cause: {
            _tag: "CustomerAccountAccessError",
            reason: "unavailable",
          },
        });
        expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
        expect(scenario.createDraft).not.toHaveBeenCalled();
      }
    );

    describe("reading the account's standing", () => {
      const accountSession = {
        accountId: customerAccountIdSchema.make(accountId),
        email: reservationCustomerEmailSchema.make(testEmailAddressForGrace),
        deletionRequested: false,
        ...testSessionProfile,
      } satisfies CustomerAccountSession;

      test.each([
        [
          "awaits deletion",
          {
            kind: "deletion-pending",
            session: accountSession,
            reviewMarker: "absent",
          },
          { reason: "unauthenticated" },
        ],
        [
          "has an unverified email",
          { kind: "unverified" },
          { reason: "unverified-email" },
        ],
        [
          "cannot read its stored link",
          {
            kind: "unavailable",
            session: accountSession,
            reviewMarker: "absent",
            failure: customerAccountUnavailable("account-link.read"),
          },
          { reason: "unavailable", cause: { code: "account-link.read" } },
        ],
      ] as const)(
        "refuses an account booking whose account %s before pricing it",
        async (_label, standing, cause) => {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            customer: "account",
            standing: Effect.succeed(standing),
          });

          expect(scenario.result).toBeUndefined();
          expect(scenario.error).toMatchObject({
            _tag: "PublicSafeActionError",
            cause: { _tag: "CustomerAccountAccessError", ...cause },
          });
          expect(scenario.peekStanding).toHaveBeenCalledTimes(1);
          expect(scenario.completeProfile).not.toHaveBeenCalled();
          expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
          expect(scenario.createDraft).not.toHaveBeenCalled();
        }
      );

      test("books a linked account whose review marker can't be read as its customer", async () => {
        const linkedContact = mock(() => accountContact());
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          customer: "account",
          standing: Effect.succeed({
            kind: "linked",
            session: accountSession,
            reviewMarker: "unreadable",
            account: {
              accountId: accountSession.accountId,
              dotyposCustomerId: accountDotyposCustomerId as DotyposCustomerId,
            },
            autoLinked: false,
          }),
          linkedContact,
        });

        expect(scenario.result?.status).toBe("ready");
        expect(linkedContact.mock.calls[0]?.[0]).toMatchObject({
          accountId,
          dotyposCustomerId: accountDotyposCustomerId,
          email: testEmailAddressForGrace,
        });
        expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
      });
    });

    describe("with a remembered referral code", () => {
      const linkedAccount = () =>
        Effect.succeed({
          accountId,
          dotyposCustomerId: accountDotyposCustomerId,
          email: testEmailAddressForGrace,
        } as never);
      const signedStateOf = async (
        result: { readonly redirectUrl?: string } | object | undefined
      ) => {
        const { openPayState, payStateTokenQueryParam } = await import(
          "@/features/checkout/backend/checkout"
        );
        const redirectUrl =
          result && "redirectUrl" in result ? result.redirectUrl : undefined;
        const token = new URL(
          redirectUrl ?? "",
          "https://deskohub.test"
        ).searchParams.get(payStateTokenQueryParam);
        return token
          ? Effect.runSync(
              openPayState(token).pipe(Effect.provide(TestSealedStateKeys))
            )
          : undefined;
      };
      const referralAppliedOf = (redirectUrl: string | undefined) =>
        new URL(redirectUrl ?? "", "https://deskohub.test").searchParams.get(
          "referralApplied"
        );

      test.each(["eligible", "already_accepted"] as const)(
        "carries an %s referral in the first Pay state without attributing it, and marks it",
        async (kind) => {
          const lockProbe = { held: false };
          const order: string[] = [];
          const quotedReferralCodes: unknown[] = [];
          const evaluateCheckoutReferral = mock(() =>
            Effect.sync(() => {
              order.push(
                lockProbe.held ? "evaluate:locked" : "evaluate:unlocked"
              );
              return kind === "eligible"
                ? { kind, code: "RFL12345" }
                : { kind };
            })
          );
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            accountAuthority: {
              session: {},
              activityState: "active",
              lockProbe,
            },
            ...linkedAccountBooking(),
            linkedAccount: linkedAccount(),
            rememberedReferralCode: "RFL12345",
            evaluateCheckoutReferral,
            quoteForCustomer: mock(
              ({ affirmedAdvertisement, referralCode }) => {
                order.push("quote");
                quotedReferralCodes.push(referralCode);
                return Effect.succeed(
                  buildQuoteFromAdvertisement(affirmedAdvertisement)
                );
              }
            ),
          });

          expect(scenario.result?.status).toBe("ready");
          expect(evaluateCheckoutReferral).toHaveBeenCalledTimes(1);
          expect(evaluateCheckoutReferral.mock.calls[0]?.[0]).toEqual({
            code: "RFL12345",
            dotyposCustomerId: accountDotyposCustomerId,
          });
          expect(order).toEqual(["evaluate:locked", "quote"]);
          const carried = kind === "eligible" ? "RFL12345" : undefined;
          expect(quotedReferralCodes).toEqual([carried]);
          expect((await signedStateOf(scenario.result))?.referralCode).toBe(
            carried
          );
          expect(
            referralAppliedOf(
              scenario.result && "redirectUrl" in scenario.result
                ? scenario.result.redirectUrl
                : undefined
            )
          ).toBe("1");
        }
      );

      // A quote whose only discount is the 15% invitation of this customer.
      const invitationQuoteFor = (dotyposCustomerId: string) => {
        const advertised = makeAdvertisementQuote(1500, "Referral discount");
        return buildQuoteFromAdvertisement(
          discountAdvertisementQuoteCodec.make({
            ...advertised,
            discounts: advertised.discounts.map((applied) => ({
              ...applied,
              discount: {
                ...applied.discount,
                id: getReferralBenefitIds(dotyposCustomerId as never)
                  .invitation,
              },
            })),
          })
        );
      };
      const referralBookingQuoting = (
        quote: ReturnType<typeof buildQuoteFromAdvertisement>,
        rememberedReferralCode: string | undefined
      ) => ({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: createFreshDraft(),
        ...linkedAccountBooking(),
        linkedAccount: linkedAccount(),
        rememberedReferralCode,
        evaluateCheckoutReferral: mock(() =>
          Effect.succeed({ kind: "eligible" as const, code: "RFL12345" })
        ),
        quoteForCustomer: mock(() => Effect.succeed(quote)),
      });
      const markerOf = (result: object | undefined) =>
        referralAppliedOf(
          result && "redirectUrl" in result
            ? (result.redirectUrl as string)
            : undefined
        );

      test("reports the referral applied when the carried referral prices the booked customer's invitation", async () => {
        const scenario = await runReusableReservationScenario(
          referralBookingQuoting(
            invitationQuoteFor(accountDotyposCustomerId),
            "RFL12345"
          )
        );

        expect(scenario.result).toMatchObject({
          status: "ready",
          referralApplied: true,
        });
        expect(markerOf(scenario.result)).toBe("1");
      });

      test.each([
        [
          "no discount",
          () => buildQuoteFromAdvertisement(makeAdvertisementQuote()),
        ],
        ["another customer's invitation", () => invitationQuoteFor("60999")],
      ] as const)(
        "leaves the referral unreported when the carried referral prices %s, keeping the URL marker",
        async (_label, quote) => {
          const scenario = await runReusableReservationScenario(
            referralBookingQuoting(quote(), "RFL12345")
          );

          expect(scenario.result?.status).toBe("ready");
          expect(scenario.result).not.toHaveProperty("referralApplied");
          expect(markerOf(scenario.result)).toBe("1");
        }
      );

      test("leaves the referral unreported for an invitation price without a carried referral", async () => {
        const scenario = await runReusableReservationScenario(
          referralBookingQuoting(
            invitationQuoteFor(accountDotyposCustomerId),
            undefined
          )
        );

        expect(scenario.result?.status).toBe("ready");
        expect(scenario.evaluateCheckoutReferral).not.toHaveBeenCalled();
        expect(scenario.result).not.toHaveProperty("referralApplied");
        expect(markerOf(scenario.result)).toBeNull();
      });

      test("carries an eligible referral for the customer a first profile saved at checkout created", async () => {
        const order: string[] = [];
        const completeProfile = mock(() =>
          Effect.sync(() => order.push("profile")).pipe(
            Effect.andThen(
              accountContact({ dotyposCustomerId: createdCustomerId })
            )
          )
        );
        const evaluateCheckoutReferral = mock(() =>
          Effect.sync(() => {
            order.push("evaluate");
            return { kind: "eligible" as const, code: "RFL12345" };
          })
        );
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          customer: "account",
          account: unlinkedAccountState(),
          completeProfile,
          rememberedReferralCode: "RFL12345",
          evaluateCheckoutReferral,
        });

        expect(scenario.result?.status).toBe("ready");
        expect(order).toEqual(["profile", "evaluate"]);
        expect(evaluateCheckoutReferral.mock.calls).toEqual([
          [{ code: "RFL12345", dotyposCustomerId: createdCustomerId }],
        ]);
        expect(scenario.quoteForCustomer.mock.calls[0]?.[0]).toMatchObject({
          dotyposCustomerId: createdCustomerId,
          referralCode: "RFL12345",
        });
        expect((await signedStateOf(scenario.result))?.referralCode).toBe(
          "RFL12345"
        );
        expect(scenario.findAvailableCode).not.toHaveBeenCalled();
      });

      test.each(["already_attributed"] as const)(
        "continues checkout silently without the code when evaluation fails as %s",
        async (reason) => {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            ...linkedAccountBooking(),
            linkedAccount: linkedAccount(),
            rememberedReferralCode: "RFL12345",
            evaluateCheckoutReferral: mock(() =>
              Effect.fail(new ReferralError({ reason }))
            ),
          });

          expect(scenario.result?.status).toBe("ready");
          expect(scenario.evaluateCheckoutReferral).toHaveBeenCalledTimes(1);
          expect(scenario.createDraft).toHaveBeenCalledTimes(1);
          expect(
            (await signedStateOf(scenario.result))?.referralCode
          ).toBeUndefined();
          expect(
            referralAppliedOf(
              scenario.result && "redirectUrl" in scenario.result
                ? scenario.result.redirectUrl
                : undefined
            )
          ).toBeNull();
        }
      );

      test("continues checkout and keeps the code when the booker's settlement cannot be read", async () => {
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          ...linkedAccountBooking(),
          rememberedReferralCode: "RFL12345",
          evaluateCheckoutReferral: mock(() =>
            Effect.succeed({ kind: "already_accepted" as const })
          ),
          hasSettledReferral: mock(() => Effect.fail(dotyposOutage)),
        });

        expect(scenario.result?.status).toBe("ready");
        expect(scenario.createDraft).toHaveBeenCalledTimes(1);
        expect(scenario.hasSettledReferral).toHaveBeenCalledTimes(1);
        expect(scenario.rememberedReferralCodeAfter).toBe("RFL12345");
      });

      type PreparedResult = Awaited<
        ReturnType<typeof runReusableReservationScenario>
      >["result"];
      const redirectUrlOf = (result: PreparedResult) =>
        result && "redirectUrl" in result ? result.redirectUrl : undefined;
      const requestedCodeOf = async (result: PreparedResult) => {
        const { openPayState, payStateTokenQueryParam } = await import(
          "@/features/checkout/backend/checkout"
        );
        const token = new URL(
          redirectUrlOf(result) ?? "",
          "https://deskohub.test"
        ).searchParams.get(payStateTokenQueryParam);
        return Effect.runSync(
          openPayState(token ?? "").pipe(Effect.provide(TestSealedStateKeys))
        ).requestedDiscountCode;
      };

      test("prefills a usable code for a contact booking without accepting it", async () => {
        const findAvailableCode = mock(() => Effect.succeed("RFL12345"));
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          rememberedReferralCode: "RFL12345",
          findAvailableCode,
        });

        expect(scenario.result?.status).toBe("ready");
        expect(findAvailableCode.mock.calls).toEqual([[{ code: "RFL12345" }]]);
        expect(scenario.evaluateCheckoutReferral).not.toHaveBeenCalled();
        expect(await requestedCodeOf(scenario.result)).toBe("RFL12345");
        expect(redirectUrlOf(scenario.result)).not.toContain("RFL12345");
        expect(referralAppliedOf(redirectUrlOf(scenario.result))).toBeNull();
      });

      test.each([
        ["unusable", () => Effect.succeed(undefined)],
        ["unreadable", () => Effect.fail(databaseOutage)],
      ] as const)(
        "continues a contact booking without a prefill for an %s code",
        async (_label, lookup) => {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            rememberedReferralCode: "RFL12345",
            findAvailableCode: mock(lookup),
          });

          expect(scenario.result?.status).toBe("ready");
          expect(scenario.evaluateCheckoutReferral).not.toHaveBeenCalled();
          expect(await requestedCodeOf(scenario.result)).toBeUndefined();
        }
      );

      test("keeps an explicitly requested discount code over the referral prefill", async () => {
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          advertisedPriceToken: await buildAdvertisedPriceToken(
            undefined,
            undefined,
            undefined,
            "CAMPAIGN10"
          ),
          rememberedReferralCode: "RFL12345",
          findAvailableCode: mock(() => Effect.succeed("RFL12345")),
        });

        expect(scenario.result?.status).toBe("ready");
        expect(await requestedCodeOf(scenario.result)).toBe("CAMPAIGN10");
      });

      test("does not prefill an account booking's referral code", async () => {
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          ...linkedAccountBooking(),
          linkedAccount: linkedAccount(),
          rememberedReferralCode: "RFL12345",
          evaluateCheckoutReferral: mock(() =>
            Effect.fail(new ReferralError({ reason: "already_attributed" }))
          ),
        });

        expect(scenario.result?.status).toBe("ready");
        expect(scenario.findAvailableCode).not.toHaveBeenCalled();
        expect(await requestedCodeOf(scenario.result)).toBeUndefined();
      });

      test.each([
        [
          "the signed-in account",
          () => ({
            ...linkedAccountBooking(),
            linkedAccount: linkedAccount(),
          }),
          accountDotyposCustomerId,
        ],
        [
          "an account whose first profile this checkout saved",
          () => {
            // The claimed link is read back once the state is created.
            let reads = 0;
            const unlinked = unlinkedAccountState();
            return {
              customer: "account" as const,
              account: Effect.suspend(() =>
                reads++ === 0
                  ? unlinked
                  : Effect.succeed({
                      status: "linked",
                      accountId,
                      dotyposCustomerId: createdCustomerId,
                      email: testEmailAddressForGrace,
                    } as never)
              ),
              completeProfile: profileCompletion(),
            };
          },
          createdCustomerId,
        ],
      ] as const)(
        "forgets the remembered code once %s booked customer is settled",
        async (_label, booking, dotyposCustomerId) => {
          const hasSettledReferral = mock(() => Effect.succeed(true));
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            ...booking(),
            evaluateCheckoutReferral: mock(() =>
              Effect.succeed({ kind: "already_accepted" as const })
            ),
            rememberedReferralCode: "RFL12345",
            hasSettledReferral,
          });

          expect(scenario.result?.status).toBe("ready");
          expect(hasSettledReferral.mock.calls).toEqual([
            [{ dotyposCustomerId }],
          ]);
          expect(scenario.rememberedReferralCodeAfter).toBeUndefined();
        }
      );

      test.each([
        ["a settled friend leaves the booker's code", false, true],
        ["a settled booker clears the booker's code", true, false],
      ] as const)(
        "checks the booker, not the friend, when booking for someone else: %s",
        async (_label, bookerSettled, kept) => {
          // The friend booked for is always settled; only the booker's own
          // customer decides whether the booker's remembered code is used.
          const hasSettledReferral = mock(
            ({ dotyposCustomerId }: { readonly dotyposCustomerId: string }) =>
              Effect.succeed(
                dotyposCustomerId === accountDotyposCustomerId
                  ? bookerSettled
                  : true
              )
          );
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            linkedAccount: linkedAccount(),
            rememberedReferralCode: "RFL12345",
            findAvailableCode: mock(() => Effect.succeed(undefined)),
            hasSettledReferral,
          });

          expect(scenario.result?.status).toBe("ready");
          expect(hasSettledReferral.mock.calls).toEqual([
            [{ dotyposCustomerId: accountDotyposCustomerId }],
          ]);
          expect(scenario.rememberedReferralCodeAfter).toBe(
            kept ? "RFL12345" : undefined
          );
        }
      );

      test.each([
        ["unsettled", () => Effect.succeed(false)],
        ["unknown", () => Effect.fail(dotyposOutage)],
      ] as const)(
        "keeps the remembered code while the booker's customer is %s",
        async (_label, settled) => {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            linkedAccount: linkedAccount(),
            rememberedReferralCode: "RFL12345",
            findAvailableCode: mock(() => Effect.succeed("RFL12345")),
            hasSettledReferral: mock(settled),
          });

          expect(scenario.result?.status).toBe("ready");
          expect(scenario.hasSettledReferral).toHaveBeenCalledTimes(1);
          expect(await requestedCodeOf(scenario.result)).toBe("RFL12345");
          expect(scenario.rememberedReferralCodeAfter).toBe("RFL12345");
        }
      );

      // The remembered-code reader already reports nothing while the program
      // is withheld; even a code that still reaches preparation stays inert.
      test.each([
        ["a contact booking", () => ({})],
        [
          "the signed-in account",
          () => ({
            ...linkedAccountBooking(),
            linkedAccount: linkedAccount(),
          }),
        ],
      ] as const)(
        "carries, prefills, and forgets nothing for %s while referrals are withheld",
        async (_label, booking) => {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            ...booking(),
            rememberedReferralCode: "RFL12345",
            referralService: WithheldReferralService,
          });

          expect(scenario.result?.status).toBe("ready");
          expect(
            (await signedStateOf(scenario.result))?.referralCode
          ).toBeUndefined();
          expect(await requestedCodeOf(scenario.result)).toBeUndefined();
          expect(referralAppliedOf(redirectUrlOf(scenario.result))).toBeNull();
          expect(scenario.rememberedReferralCodeAfter).toBe("RFL12345");
        }
      );
    });

    test("resolves the Dotypos customer from the submitted contact without an account booking", async () => {
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: createFreshDraft(),
      });

      expect(scenario.result?.status).toBe("ready");
      expect(scenario.peekStanding).not.toHaveBeenCalled();
      expect(scenario.findOrCreateCustomer).toHaveBeenCalledTimes(1);
      expect(scenario.findOrCreateCustomer.mock.calls[0]?.[0]).toMatchObject({
        email: reservation.email,
        phone: "+420777777777",
      });
      expect(scenario.createDraft.mock.calls[0]?.[0]).toMatchObject({
        dotyposCustomerId: "customer-id",
      });
      expect(
        scenario.quoteForCustomer.mock.calls[0]?.[0].reservation
      ).toMatchObject({ name: reservation.name, email: reservation.email });
    });
  });

  describe("contact email deliverability", () => {
    test("rejects a contact email whose domain cannot receive mail before creating a customer or hold", async () => {
      const { m } = await import("@/features/i18n");
      const checkContactEmailDomain = mock(() =>
        Effect.succeed("rejects_mail" as const)
      );
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: mock(() => Effect.die("no draft may be created")),
        checkContactEmailDomain,
        marketingConsent: true,
      });

      expect(scenario.error).toMatchObject({
        _tag: "PublicSafeActionError",
        message: m.contactValidationEmailUndeliverable({}, { locale: "en-US" }),
        cause: { _tag: "UndeliverableContactEmailError" },
      });
      expect(checkContactEmailDomain).toHaveBeenCalledWith(reservation.email);
      expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
      expect(scenario.recordMarketingConsent).not.toHaveBeenCalled();
      expect(scenario.createDraft).not.toHaveBeenCalled();
      expect(scenario.createReservation).not.toHaveBeenCalled();
      expect(scenario.enqueueCleanup).not.toHaveBeenCalled();
    });

    test("continues the booking when the domain lookup is inconclusive", async () => {
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: mock((input) =>
          Effect.succeed(
            makeReusableReservation({
              id: "new-reservation-id",
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
              correlationId: "new-correlation-id",
              dotyposCustomerId: input.dotyposCustomerId,
              reservationDetails: input.reservationDetails,
              locale: input.locale,
              reservationHoldExpiresAt: input.reservationHoldExpiresAt,
            })
          )
        ),
        checkContactEmailDomain: mock(() => Effect.succeed("unknown" as const)),
      });

      expect(scenario.result?.status).toBe("ready");
      expect(scenario.findOrCreateCustomer).toHaveBeenCalledTimes(1);
    });

    test("does not check the signed-in account's own email", async () => {
      const checkContactEmailDomain = mock(() =>
        Effect.succeed("rejects_mail" as const)
      );
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: mock((input) =>
          Effect.succeed(
            makeReusableReservation({
              id: "account-reservation-id",
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
              correlationId: "account-correlation-id",
              dotyposCustomerId: input.dotyposCustomerId,
              reservationDetails: input.reservationDetails,
              locale: input.locale,
              reservationHoldExpiresAt: input.reservationHoldExpiresAt,
            })
          )
        ),
        customer: "account",
        account: Effect.succeed({
          status: "linked",
          accountId: "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01",
          dotyposCustomerId: "60111",
          email: testEmailAddress("grace"),
        } as never),
        linkedContact: mock(() =>
          Effect.succeed({
            accountId: "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01",
            dotyposCustomerId: "60111",
            name: "Grace Hopper",
            email: testEmailAddress("grace"),
            phone: "+420 602 123 456",
          } as never)
        ),
        checkContactEmailDomain,
      });

      expect(scenario.result?.status).toBe("ready");
      expect(checkContactEmailDomain).not.toHaveBeenCalled();
    });
  });

  test("reuses a held reservation returned by a conflicting draft insert", async () => {
    const claimConflictReservation = makeReusableReservation({
      id: "claim-conflict-reservation-id",
    });
    const result = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      createDraft: mock((input) =>
        Effect.succeed({
          ...claimConflictReservation,
          checkoutSessionKey: input.checkoutSessionKey,
          checkoutAttemptKey: input.checkoutAttemptKey,
        })
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.claimHoldCreation).not.toHaveBeenCalled();
    expect(result.findById).not.toHaveBeenCalled();
    expect(result.enqueueCleanup).not.toHaveBeenCalled();
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
      findByAttemptKeys: mock(() =>
        Effect.succeed(
          attemptLookupCount++ === 0 ? null : replacementReservation
        )
      ),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(cancellingReservation)
      ),
      findById: mock(() =>
        Effect.succeed(
          makeReusableReservation({ reservationState: "cancelled" })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(attemptLookupCount).toBe(2);
    expect(result.cancelReservation).not.toHaveBeenCalled();
    expect(result.createDraft).not.toHaveBeenCalled();
    expect(result.claimHoldCreation).not.toHaveBeenCalled();
  });

  test("supersedes a hold stored before a Pay-state key rotation under its stored session key", async () => {
    const storedSessionKey = "original:stored-session-key";
    const previousReservation = makeReusableReservation({
      id: "previous-reservation-id",
      checkoutSessionKey: storedSessionKey as never,
      dotyposReservationId: "previous-dotypos-reservation-id",
    });
    const findStoredCheckoutSessionKey = mock(() =>
      Effect.succeed(storedSessionKey)
    );
    const findCurrentByCheckoutSessionKey = mock(() =>
      Effect.succeed(previousReservation)
    );
    const result = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      findStoredCheckoutSessionKey,
      findCurrentByCheckoutSessionKey,
      claimSupersessionCancellation: mock(() =>
        Effect.succeed(previousReservation)
      ),
      completeSupersessionAndCreateDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            id: "replacement-reservation-id",
            checkoutSessionKey: input.replacement.checkoutSessionKey,
            checkoutAttemptKey: input.replacement.checkoutAttemptKey,
            dotyposReservationId: null,
            reservationState: "draft",
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(findStoredCheckoutSessionKey).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringMatching(/^test:[a-f0-9]{64}$/)])
    );
    expect(findCurrentByCheckoutSessionKey).toHaveBeenCalledWith(
      storedSessionKey
    );
    expect(result.completeSupersessionAndCreateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        replacement: expect.objectContaining({
          checkoutSessionKey: storedSessionKey,
          checkoutAttemptKey: expect.stringMatching(storedLookupKeyPattern),
        }),
      })
    );
  });

  test("groups a new draft under its session's stored key after a Pay-state key rotation", async () => {
    const storedSessionKey = "original:stored-session-key";
    const findCurrentByCheckoutSessionKey = mock(() => Effect.succeed(null));
    const result = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      findStoredCheckoutSessionKey: mock(() =>
        Effect.succeed(storedSessionKey)
      ),
      findCurrentByCheckoutSessionKey,
      createDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(findCurrentByCheckoutSessionKey).toHaveBeenCalledWith(
      storedSessionKey
    );
    expect(result.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutSessionKey: storedSessionKey })
    );
  });

  test("starts a new session under its stored lookup key and accepts both formats", async () => {
    const result = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      createDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutSessionKey: expect.stringMatching(storedLookupKeyPattern),
        checkoutAttemptKey: expect.stringMatching(storedLookupKeyPattern),
        checkoutSessionLockKey: expect.any(BigInt),
        acceptedCheckoutSessionKeys: expect.arrayContaining([
          expect.stringMatching(/^test:[a-f0-9]{64}$/),
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ]),
        acceptedCheckoutAttemptKeys: expect.arrayContaining([
          expect.stringMatching(/^test:[a-f0-9]{64}$/),
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ]),
      })
    );
  });

  test.each([
    {
      label: "tampered token",
      token: async () => tamperToken(await buildAdvertisedPriceToken()),
      reservation,
      reason: "invalid_token",
    },
    {
      label: "expired token",
      token: () =>
        buildAdvertisedPriceToken(
          buildCoworkReservationQuote(reservation),
          -1000
        ),
      reservation,
      reason: "invalid_token",
    },
    {
      label: "cowork snapshot for different reservation inputs",
      token: () => buildAdvertisedPriceToken(),
      reservation: { ...reservation, coffee: true },
      reason: "input_mismatch",
    },
    {
      label: "cowork snapshot for a meeting-room submission",
      token: () => buildAdvertisedPriceToken(),
      reservation: meetingRoomReservationInput,
      reason: "input_mismatch",
    },
    {
      label: "meeting-room snapshot for a cowork submission",
      token: () =>
        buildMeetingRoomAdvertisedPriceToken({
          duration: { unit: "hour", amount: 4 },
          reservationDate: "2099-06-10",
        }),
      reservation,
      reason: "input_mismatch",
    },
    {
      label: "cowork snapshot sealed for another locale",
      token: () => buildAdvertisedPriceToken(undefined, undefined, "cs-CZ"),
      reservation,
      reason: "input_mismatch",
    },
    {
      label: "meeting-room snapshot sealed for another locale",
      token: () =>
        buildMeetingRoomAdvertisedPriceToken(
          {
            duration: { unit: "hour", amount: 4 },
            reservationDate: "2099-06-10",
          },
          "cs-CZ"
        ),
      reservation: meetingRoomReservationInput,
      reason: "input_mismatch",
    },
  ])("rejects a $label before downstream work", async (row) => {
    const prepareFromReservationForm = await loadReservationFormPreparation();
    const { recordCheckoutAnalytics } = await import(
      "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
    );
    const { BotProtectionServiceMock } = await import(
      "@/shared/backend/bot-protection/bot-protection.service.mock"
    );
    const { layer: accountAuthorityLayer } = await accountAuthorityFixture();
    const effect = prepareFromReservationForm({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: await row.token(),
      reservation: row.reservation,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          accountAuthorityLayer,
          inertRememberedReferral(),
          BotProtectionServiceMock({ verifyHuman: () => Effect.void }),
          CheckoutPricingServiceMock({}),
          recordCheckoutAnalytics().layer,
          TestSealedStateKeys
        )
      )
    ) as Effect.Effect<never, unknown, never>;

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      cause: {
        _tag: "AdvertisedPriceMismatchError",
        reason: row.reason,
      },
    });
  });

  test("returns a usable pricing_changed summary when an advertised sale disappears", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const advertisedDiscount = makeAdvertisementQuote(5000);
    const result = await runReusableReservationScenario({
      holdForAttempt: reuseHold(makeReusableReservation()),
      advertisedPriceToken: await buildAdvertisedPriceToken(
        buildQuoteFromAdvertisement(advertisedDiscount)
      ),
      affirmAdvertisement: mock(() =>
        Effect.succeed(makeAdvertisementAffirmation())
      ),
    });

    expect(result.result).toMatchObject({
      status: "pricing_changed",
      affectedProductKeys: ["product:cowork:open-space"],
    });
    if (result.result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    const token = new URL(
      result.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const state = Effect.runSync(
      openPayState(token ?? "").pipe(Effect.provide(TestSealedStateKeys))
    );
    expect(state.changedKeys?.itemKeys).toContain("product:cowork:open-space");
    expect(state.quote.payment.discounts).toEqual([]);
    expect(result.result.payStateToken).toBe(token ?? "");
  });

  test("allows the customer discount to first appear on a ready summary", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const customerQuote = makeAdvertisementQuote(1000, "Customer discount");
    const result = await runReusableReservationScenario({
      holdForAttempt: reuseHold(makeReusableReservation()),
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
    const state = Effect.runSync(
      openPayState(token ?? "").pipe(Effect.provide(TestSealedStateKeys))
    );
    expect(state.changedKeys).toBeUndefined();
    expect(state.quote.payment.discounts).toHaveLength(1);
    expect(state.quote.payment.discounts[0]?.discount.label).toBe(
      "Customer discount"
    );
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "rejects a classified bot before resolving downstream services in %s",
    async (locale) => {
      const prepareFromReservationForm = await loadReservationFormPreparation();
      const { BotDetectedError } = await import(
        "@/shared/backend/bot-protection/bot-protection.service"
      );
      const { BotProtectionServiceMock } = await import(
        "@/shared/backend/bot-protection/bot-protection.service.mock"
      );
      const { m } = await import("@/features/i18n");
      const verifyHuman = mock(() =>
        Effect.fail(
          new BotDetectedError({
            message: "Automated request detected",
            reason: "unverified_bot",
          })
        )
      );
      const { layer: accountAuthorityLayer } = await accountAuthorityFixture();
      const effect = prepareFromReservationForm({
        locale,
        checkoutSessionId: "session-id",
        checkoutAttemptId: "attempt-id",
        advertisedPriceToken: "invalid-but-bot-rejects-first",
        reservation,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            accountAuthorityLayer,
            inertRememberedReferral(),
            BotProtectionServiceMock({ verifyHuman }),
            CheckoutPricingServiceMock({})
          )
        )
      ) as Effect.Effect<never, unknown, never>;

      const error = await Effect.runPromise(Effect.flip(effect));

      expect(error).toMatchObject({
        _tag: "PublicSafeActionError",
        message: m.automatedRequestRejected({}, { locale }),
      });
      expect(verifyHuman).toHaveBeenCalledWith({
        verificationFailurePolicy: "allow",
        verifiedBots: { allow: customerAgentNames },
        callSite: "reservation.prepare-pay-state",
      });
    }
  );
});
