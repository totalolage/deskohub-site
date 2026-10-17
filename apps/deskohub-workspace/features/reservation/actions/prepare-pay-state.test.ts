import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { EmailRecipientDomainServiceMock } from "@deskohub/email/backend/recipient-domain.service.mock";
import { testEmailAddress } from "@deskohub/test-email";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Duration, Effect, Layer, Schema } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import type { OptionalAccountActivityFixture } from "@/features/account/backend/customer-account-activity.test-utils";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountAccessError } from "@/features/account/customer-account";
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
import { PromotionCodeUnavailableError } from "@/features/discounts/errors";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type { ICustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { ReferralError } from "@/features/referrals/contracts";
import type { ReferralService } from "@/features/referrals/referral.service";
import {
  ReferralServiceMock,
  WithheldReferralService,
} from "@/features/referrals/referral.service.mock";
import type { IWorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { meetingRoomAdvertisedPriceReservationSchema } from "@/features/reservation/meeting-room-reservation";
import { getSlowestSuccessfulCalendarLoad } from "@/shared/backend/config/google-calendar.config.test-utils";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const testEmailAddressForAda = testEmailAddress("ada");
const testEmailAddressForGrace = testEmailAddress("grace");

mock.module("server-only", () => ({}));

mock.module("@/features/legal/acceptance-snapshot", () => ({
  getLegalAcceptanceSnapshot: mock(() =>
    Effect.succeed({
      privacyPolicy: {
        path: "/legal/privacy.md",
        content: "Privacy test content",
        hash: "privacy-hash",
        hashAlgorithm: "sha256",
      },
      marketingCommunications: {
        path: "/legal/marketing.md",
        content: "Marketing test content",
        hash: "marketing-hash",
        hashAlgorithm: "sha256",
      },
    })
  ),
}));

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

// The referral code this browser remembers from a shared link.
let rememberedReferralCode: string | undefined;
mock.module("@/features/referrals/remembered-referral-code.server", () => ({
  readRememberedReferralCode: Effect.sync(() => rememberedReferralCode),
  forgetRememberedReferralCode: async () => {
    rememberedReferralCode = undefined;
  },
}));

// Format of the checkout lookup keys new rows store: the active key's
// key-ID-prefixed digest.
const storedLookupKeyPattern = /^test:[a-f0-9]{64}$/;

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

const buildAdvertisedPriceToken = async (
  quote: CoworkReservationQuote = buildCoworkReservationQuote(reservation),
  ttlMilliseconds?: number,
  locale: "en-US" | "cs-CZ" = "en-US",
  requestedDiscountCode?: string
) => {
  const { buildAdvertisedPriceState, sealAdvertisedPriceState } = await import(
    "@/features/checkout/backend/checkout"
  );
  return Effect.gen(function* () {
    const state = yield* buildAdvertisedPriceState({
      kind: "cowork",
      locale,
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
      ...(requestedDiscountCode !== undefined && {
        requestedDiscountCode: Schema.decodeUnknownSync(
          canonicalPromotionCodeSchema
        )(requestedDiscountCode),
      }),
    });
    return yield* sealAdvertisedPriceState(state);
  }).pipe(Effect.runPromise);
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

const makeReusableReservation = (
  overrides: Partial<WorkspaceReservation> = {}
): WorkspaceReservation =>
  ({
    id: "existing-reservation-id",
    checkoutSessionKey: "session-key",
    checkoutAttemptKey: "attempt-key",
    correlationId: "correlation-id",
    dotyposCustomerId: "customer-id",
    dotyposReservationId: "dotypos-reservation-id",
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
  }) as WorkspaceReservation;

const accountAuthorityFixture = async (
  options?: OptionalAccountActivityFixture
) => {
  const { makeOptionalAccountActivityGuard } = await import(
    "@/features/account/backend/customer-account-activity.test-utils"
  );
  return makeOptionalAccountActivityGuard(options);
};

const runReusableReservationScenario = async (input: {
  readonly findByAttemptKeys: ReturnType<typeof mock>;
  readonly findCurrentByCheckoutSessionKey?: ReturnType<typeof mock>;
  readonly findStoredCheckoutSessionKey?: ReturnType<typeof mock>;
  readonly createDraft?: ReturnType<typeof mock>;
  readonly assignAuthor?: ReturnType<typeof mock>;
  readonly claimHoldCreation?: ReturnType<typeof mock>;
  readonly findById?: ReturnType<typeof mock>;
  readonly claimSupersessionCancellation?: ReturnType<typeof mock>;
  readonly completeSupersessionAndCreateDraft?: ReturnType<typeof mock>;
  readonly cancelReservation?: ReturnType<typeof mock>;
  readonly createReservation?: ReturnType<typeof mock>;
  readonly getReservationStatus?: ReturnType<typeof mock>;
  readonly markCancellationFailed?: ReturnType<typeof mock>;
  readonly advertisedPriceToken?: string;
  readonly marketingConsent?: boolean;
  readonly affirmAdvertisement?: ReturnType<typeof mock>;
  readonly quoteForCustomer?: ReturnType<typeof mock>;
  readonly ensureAvailable?: ReturnType<typeof mock>;
  readonly grantInitialMarketingConsent?: ReturnType<typeof mock>;
  readonly findOrCreateCustomer?: ReturnType<typeof mock>;
  readonly reservation?: typeof reservation;
  readonly accountAuthority?: Parameters<typeof accountAuthorityFixture>[0];
  readonly customer?: "account";
  readonly accountContact?: CustomerAccountContactService["Service"]["current"];
  readonly linkedAccount?: CustomerAccountContactService["Service"]["currentLinkedAccount"];
  readonly rememberedReferralCode?: string;
  readonly evaluateCheckoutReferral?: ReturnType<typeof mock>;
  readonly findAvailableCode?: ReturnType<typeof mock>;
  readonly hasSettledReferral?: ReturnType<typeof mock>;
  /** Replaces the mocked referral operations above. */
  readonly referralService?: Layer.Layer<ReferralService>;
  readonly checkContactEmailDomain?: ReturnType<typeof mock>;
}) => {
  const { prepareWorkspacePayState } = await import("./prepare-pay-state");
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const { CustomerMarketingConsentRepository } = await import(
    "@/features/legal/backend/customer-marketing-consent.repository"
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
  const grantInitialMarketingConsent =
    input.grantInitialMarketingConsent ?? mock(() => Effect.void);
  const grantMarketingConsent = mock(() => Effect.void);
  const getMarketingConsent = mock(() => Effect.succeed(null));
  const withdrawMarketingConsent = mock(() => Effect.void);
  const ensureAvailable = input.ensureAvailable ?? mock(() => Effect.void);
  const verifyHuman = mock(() => Effect.void);
  const createDraft = input.createDraft ?? mock(() => Effect.die("unused"));
  const assignAuthor =
    input.assignAuthor ??
    mock((author: { readonly authorAccountId: string }) =>
      Effect.succeed(author.authorAccountId)
    );
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
  const readAccountContact = mock(
    () =>
      input.accountContact ?? Effect.die("the account contact must not be read")
  );
  // Without a fixture the session has no linked account, as for a guest.
  const readLinkedAccount = mock(
    () => input.linkedAccount ?? Effect.succeed(null)
  );
  const evaluateCheckoutReferral =
    input.evaluateCheckoutReferral ??
    mock(() => Effect.die("a referral must not be evaluated"));
  const findAvailableCode =
    input.findAvailableCode ??
    mock(() => Effect.die("a referral code must not be looked up"));
  const hasSettledReferral =
    input.hasSettledReferral ?? mock(() => Effect.succeed(false));
  rememberedReferralCode = input.rememberedReferralCode;
  const testLayer = Layer.mergeAll(
    accountAuthority.layer,
    Layer.mock(CustomerAccountContactService, {
      current: Effect.suspend(() => readAccountContact()),
      currentLinkedAccount: Effect.suspend(() => readLinkedAccount()),
    }),
    input.referralService ??
      ReferralServiceMock({
        evaluateCheckoutReferral: evaluateCheckoutReferral as never,
        findAvailableCode: findAvailableCode as never,
        hasSettledReferral: hasSettledReferral as never,
      }),
    CheckoutPricingServiceMock({
      affirmCoworkAdvertisement: affirmAdvertisement,
      quoteForCustomer: quoteForCustomerResult as never,
    }),
    BotProtectionServiceMock({ verifyHuman }),
    EmailRecipientDomainServiceMock({ check: checkContactEmailDomain }),
    Layer.mock(WorkspaceAvailabilityService, {
      getAvailability: mock(() => Effect.die("unused")),
      ensureAvailable,
    } satisfies IWorkspaceAvailabilityService),
    Layer.mock(WorkspaceReservationRepository, {
      findByAttemptKeys: input.findByAttemptKeys,
      findCurrentByCheckoutSessionKey:
        input.findCurrentByCheckoutSessionKey ??
        mock(() => Effect.succeed(null)),
      findStoredCheckoutSessionKey:
        input.findStoredCheckoutSessionKey ?? mock(() => Effect.succeed(null)),
      createDraft,
      assignAuthor,
      claimHoldCreation,
      findById,
      releaseHoldCreation: mock(() => Effect.void),
      updateReservationDetails,
      attachHold: mock(() => Effect.void),
      markAttachFailedCancellationRequired: mock(() => Effect.void),
      claimSupersessionCancellation,
      completeSupersessionAndCreateDraft,
      markCancelled: mock(() => Effect.void),
      markCancellationFailed,
    }),
    Layer.mock(CustomerMarketingConsentRepository, {
      grantInitial: grantInitialMarketingConsent,
      grant: grantMarketingConsent,
      get: getMarketingConsent,
      withdraw: withdrawMarketingConsent,
    } satisfies ICustomerMarketingConsentRepository),
    Layer.mock(ReservationHoldCleanupScheduleService, {
      enqueueCleanup,
    } as never),
    WorkspaceTableAssignmentServiceMock({
      assignTableId: mock(() => Effect.succeed("table-id")),
    }),
    Layer.mock(PostHogEventService, {
      capture: mock(() => Effect.void),
    }),
    Layer.mock(DotyposService, {
      findOrCreateCustomer,
      getReservationStatus,
      cancelReservation,
      createReservation,
    })
  );

  const result = await prepareWorkspacePayState({
    locale: "en-US",
    checkoutSessionId: "session-id",
    checkoutAttemptId: "attempt-id",
    advertisedPriceToken:
      input.advertisedPriceToken ?? (await buildAdvertisedPriceToken()),
    reservation: input.reservation ?? reservation,
    marketingConsent: input.marketingConsent,
    customer: input.customer,
  }).pipe(Effect.provide(testLayer), Effect.result, Effect.runPromise);

  return {
    result: result._tag === "Success" ? result.success : undefined,
    error: result._tag === "Failure" ? (result.failure as unknown) : undefined,
    guardEvents: accountAuthority.events,
    enqueueCleanup,
    assignAuthor,
    updateReservationDetails,
    grantInitialMarketingConsent,
    grantMarketingConsent,
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
    readAccountContact,
    readLinkedAccount,
    evaluateCheckoutReferral,
    findAvailableCode,
    hasSettledReferral,
    rememberedReferralCodeAfter: rememberedReferralCode,
    checkContactEmailDomain,
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
  const { prepareWorkspacePayState } = await import("./prepare-pay-state");
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
  const { CustomerMarketingConsentRepository } = await import(
    "@/features/legal/backend/customer-marketing-consent.repository"
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

  const ensureAvailable = mock(() =>
    timing
      ? Effect.sleep(Duration.max(timing.calendar, timing.dotypos))
      : Effect.void
  );
  const createDraft = mock((input) =>
    Effect.succeed({
      id: "meeting-room-reservation-id",
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
        product,
        discountableSubtotal,
        discounts: [],
        totalDiscount: basicMoney(0),
        discountedSubtotal: discountableSubtotal,
      })
  );
  const testLayer = Layer.mergeAll(
    accountAuthority.layer,
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
    Layer.mock(CustomerMarketingConsentRepository, {
      grantInitial: mock(() => Effect.void),
      grant: mock(() => Effect.void),
      get: mock(() => Effect.succeed(null)),
      withdraw: mock(() => Effect.void),
    } satisfies ICustomerMarketingConsentRepository),
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
    Layer.mock(PostHogEventService, {
      capture: mock(() => Effect.void),
    })
  );

  const submission = prepareWorkspacePayState({
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
            reasons: [
              { error: { message: "Request timed out. Please try again." } },
            ],
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
    const state = Effect.runSync(openPayState(token ?? ""));

    expect(state.requestedDiscountCode).toBe("CAMPAIGN10");
    expect(state.submittedCode).toBeUndefined();
    expect(state.submittedCodeDiscountId).toBeUndefined();
    expect(scenario.result.redirectUrl).not.toContain("CAMPAIGN10");
  });

  test("rejects office reservation issuance while the office flag is disabled", async () => {
    const { prepareWorkspacePayState } = await import("./prepare-pay-state");
    const { BotProtectionServiceMock } = await import(
      "@/shared/backend/bot-protection/bot-protection.service.mock"
    );
    const verifyHuman = mock(() => Effect.void);
    const { layer: accountAuthorityLayer } = await accountAuthorityFixture();
    const effect = prepareWorkspacePayState({
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
          BotProtectionServiceMock({ verifyHuman }),
          CheckoutPricingServiceMock({}),
          OfficeReservationFeatureFlagService.Default.pipe(
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
    const { prepareWorkspacePayState } = await import("./prepare-pay-state");
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const { CustomerMarketingConsentRepository } = await import(
      "@/features/legal/backend/customer-marketing-consent.repository"
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
        correlationId: "correlation-id",
        reservationState: "draft",
        paymentState: "not_started",
        fulfillmentState: "not_started",
        dotyposCustomerId: input.dotyposCustomerId,
        reservationDetails: input.reservationDetails,
        productTier: "basic",
        productCoffee: false,
        productMonitorOption: null,
        locale: input.locale,
        reservationHoldExpiresAt: input.reservationHoldExpiresAt,
      } as never)
    );
    const claimHoldCreation = mock(() => Effect.succeed(true));
    const attachHold = mock(() =>
      Effect.sync(() => {
        eventOrder.push("attach");
      })
    );
    const enqueueCleanup = mock(() =>
      Effect.sync(() => {
        eventOrder.push("enqueue");
      })
    );
    const grantInitialMarketingConsent = mock(() => Effect.void);
    const grantMarketingConsent = mock(() => Effect.void);
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
    const { layer: accountAuthorityLayer } = await accountAuthorityFixture();
    const testLayer = Layer.mergeAll(
      accountAuthorityLayer,
      CheckoutPricingServiceMock({
        affirmCoworkAdvertisement: affirmAdvertisement,
        quoteForCustomer: quoteForCustomerResult as never,
      }),
      BotProtectionServiceMock({ verifyHuman }),
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
        claimHoldCreation,
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
      Layer.mock(CustomerMarketingConsentRepository, {
        grantInitial: grantInitialMarketingConsent,
        grant: grantMarketingConsent,
        get: mock(() => Effect.succeed(null)),
        withdraw: mock(() => Effect.void),
      } satisfies ICustomerMarketingConsentRepository),
      WorkspaceTableAssignmentServiceMock({
        assignTableId,
      }),
      Layer.mock(ReservationHoldCleanupScheduleService, {
        enqueueCleanup,
      } as never),
      Layer.mock(DotyposService, {
        findOrCreateCustomer,
        createReservation,
      }),
      Layer.mock(PostHogEventService, {
        capture: mock(() => Effect.void),
      })
    );
    const result = await prepareWorkspacePayState({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: await buildAdvertisedPriceToken(),
      reservation,
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
      entryTier: "open-space",
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
    expect(enqueueCleanup).toHaveBeenCalledWith({
      orderId: "reservation-id",
      reservationHoldExpiresAt: expect.any(Temporal.Instant),
    });
    expect(eventOrder).toEqual([
      "bot-verification",
      "advertisement",
      "customer",
      "quote",
      "availability",
      "attach",
      "enqueue",
    ]);
    expect(verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "allow",
    });
    expect(grantInitialMarketingConsent).not.toHaveBeenCalled();

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

  test("reuses an immediate retry without scheduling cleanup", async () => {
    const existingReservation = makeReusableReservation();
    const result = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(existingReservation)),
    });

    expect(result.result.status).toBe("ready");
    expect(result.ensureAvailable).not.toHaveBeenCalled();
    expect(result.enqueueCleanup).not.toHaveBeenCalled();
    expect(result.verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "allow",
    });
    expect(result.updateReservationDetails).toHaveBeenCalledWith({
      id: existingReservation.id,
      reservationDetails: {
        kind: "cowork",
        entryTier: "open-space",
        coffee: false,
      },
      locale: "en-US",
    });
    expect(result.findOrCreateCustomer).toHaveBeenCalledTimes(1);
    expect(result.quoteForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: existingReservation.dotyposCustomerId,
      })
    );
  });

  test("records marketing opt-in against the resolved customer", async () => {
    const existingReservation = makeReusableReservation();
    const result = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(existingReservation)),
      marketingConsent: true,
    });

    expect(result.result.status).toBe("ready");
    expect(result.grantInitialMarketingConsent).toHaveBeenCalledWith({
      dotyposCustomerId: "customer-id",
      documentHash: "marketing-hash",
      locale: "en-US",
      grantedAt: expect.any(Temporal.Instant),
    });
    expect(result.grantMarketingConsent).not.toHaveBeenCalled();
  });

  test("fails checkout when an explicit marketing opt-in cannot be stored", async () => {
    const persistenceFailure = new EffectDrizzleQueryError({
      query: "customer marketing consent grant",
      params: [],
      cause: new Error("database unavailable"),
    });

    const { error } = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(makeReusableReservation())),
      marketingConsent: true,
      grantInitialMarketingConsent: mock(() => Effect.fail(persistenceFailure)),
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
    expect(scenario.grantInitialMarketingConsent).not.toHaveBeenCalled();
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
    expect(scenario.grantInitialMarketingConsent).not.toHaveBeenCalled();
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

  describe("booking as the signed-in account", () => {
    const accountDotyposCustomerId = "60111";
    const accountContact = (
      overrides: { readonly phone?: string | null } = {}
    ) =>
      Effect.succeed({
        accountId: "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01",
        dotyposCustomerId: accountDotyposCustomerId,
        name: "Grace Hopper",
        email: testEmailAddressForGrace,
        phone: "+420 602 123 456",
        ...overrides,
      } as never);
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

    test("books under the linked Dotypos customer without resolving one from the contact", async () => {
      const lockProbe = { held: false };
      const lockSamples: boolean[] = [];
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: createFreshDraft(),
        accountAuthority: { session: {}, activityState: "active", lockProbe },
        customer: "account",
        accountContact: Effect.suspend(() => {
          lockSamples.push(lockProbe.held);
          return accountContact();
        }),
      });

      expect(scenario.result?.status).toBe("ready");
      expect(scenario.readAccountContact).toHaveBeenCalledTimes(1);
      expect(lockSamples).toEqual([true]);
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
      [
        "an account booking",
        {
          customer: "account",
          accountAuthority: { session: {}, activityState: "active" },
        },
        "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01",
      ],
      [
        "a signed-in contact booking",
        { accountAuthority: { session: {}, activityState: "active" } },
        "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01",
      ],
      ["an anonymous guest", { accountAuthority: { session: null } }, null],
    ] as const)(
      "records the signed-in account as the author of %s",
      async (_label, booking, expectedAuthor) => {
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          accountContact: accountContact(),
          ...booking,
        });

        expect(scenario.result?.status).toBe("ready");
        expect(scenario.createDraft).toHaveBeenCalledTimes(1);
        expect(scenario.createDraft.mock.calls[0]?.[0]).toMatchObject({
          authorAccountId: expectedAuthor,
        });
      }
    );

    test.each([
      ["a draft", makeReusableReservation({ reservationState: "draft" })],
      ["a held retry", makeReusableReservation()],
    ] as const)(
      "makes the signed-in account the author of %s started before sign-in",
      async (_label, startedAsGuest) => {
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(startedAsGuest)),
          accountAuthority: { session: {}, activityState: "active" },
          accountContact: accountContact(),
        });

        expect(scenario.result?.status).toBe("ready");
        expect(scenario.assignAuthor).toHaveBeenCalledWith({
          id: startedAsGuest.id,
          authorAccountId: "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01",
        });
      }
    );

    test("refuses to resume a draft another account authored", async () => {
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() =>
          Effect.succeed(makeReusableReservation({ reservationState: "draft" }))
        ),
        assignAuthor: mock(() =>
          Effect.succeed("0d9c6a2e-7f41-4b8a-a6e3-2c5d9b1f4e70")
        ),
        claimHoldCreation: mock(() => Effect.die("no hold may be claimed")),
        accountAuthority: { session: {}, activityState: "active" },
        accountContact: accountContact(),
      });

      expect(scenario.error).toMatchObject({
        _tag: "PublicSafeActionError",
        cause: { _tag: "CheckoutAttemptUnavailableError" },
      });
    });

    test("leaves a guest's resumed draft without an author", async () => {
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() =>
          Effect.succeed(makeReusableReservation({ reservationState: "draft" }))
        ),
        accountAuthority: { session: null },
      });

      expect(scenario.result?.status).toBe("ready");
      expect(scenario.assignAuthor).not.toHaveBeenCalled();
    });

    test("prices the reservation with the account contact instead of the submitted one", async () => {
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: createFreshDraft(),
        accountAuthority: { session: {}, activityState: "active" },
        reservation: {
          ...reservation,
          name: "Someone Else",
          email: testEmailAddress("someone.else"),
          phone: "+420 777 777 777",
        },
        customer: "account",
        accountContact: accountContact(),
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
        "an anonymous session has no account contact",
        undefined,
        Effect.succeed(null),
      ],
      [
        "customer accounts are not configured",
        undefined,
        Effect.fail(
          new CustomerAccountAccessError({ reason: "not-configured" })
        ),
      ],
    ])(
      "reports an expired session when %s",
      async (_label, accountAuthority, contact) => {
        const { m } = await import("@/features/i18n");
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          accountAuthority,
          customer: "account",
          accountContact: contact,
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
        expect(scenario.readAccountContact).toHaveBeenCalledTimes(1);
        expect(scenario.findOrCreateCustomer).not.toHaveBeenCalled();
        expect(scenario.quoteForCustomer).not.toHaveBeenCalled();
        expect(scenario.createDraft).not.toHaveBeenCalled();
      }
    );

    test("reports an unavailable account contact as a generic reservation error", async () => {
      const { m } = await import("@/features/i18n");
      const scenario = await runReusableReservationScenario({
        findByAttemptKeys: mock(() => Effect.succeed(null)),
        createDraft: createFreshDraft(),
        accountAuthority: { session: {}, activityState: "active" },
        customer: "account",
        accountContact: Effect.fail(
          new CustomerAccountAccessError({ reason: "unavailable" })
        ),
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
    });

    describe("with a remembered referral code", () => {
      const accountId = "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01";
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
        return token ? Effect.runSync(openPayState(token)) : undefined;
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
            customer: "account",
            accountContact: accountContact(),
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
          expect(order).toEqual(["evaluate:unlocked", "quote"]);
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

      test.each(["already_attributed"] as const)(
        "continues checkout silently without the code when evaluation fails as %s",
        async (reason) => {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            accountAuthority: { session: {}, activityState: "active" },
            customer: "account",
            accountContact: accountContact(),
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

      test("continues checkout when the linked account cannot be read", async () => {
        const scenario = await runReusableReservationScenario({
          findByAttemptKeys: mock(() => Effect.succeed(null)),
          createDraft: createFreshDraft(),
          accountAuthority: { session: {}, activityState: "active" },
          customer: "account",
          accountContact: accountContact(),
          linkedAccount: Effect.fail(
            new CustomerAccountAccessError({ reason: "unavailable" })
          ),
          rememberedReferralCode: "RFL12345",
        });

        expect(scenario.result?.status).toBe("ready");
        expect(scenario.evaluateCheckoutReferral).not.toHaveBeenCalled();
        expect(scenario.createDraft).toHaveBeenCalledTimes(1);
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
        return Effect.runSync(openPayState(token ?? "")).requestedDiscountCode;
      };

      test.each([
        ["an anonymous guest", { session: null }],
        ["a contact booking", { session: {}, activityState: "active" }],
      ] as const)(
        "prefills a usable code for %s without accepting it",
        async (_label, accountAuthority) => {
          const findAvailableCode = mock(() => Effect.succeed("RFL12345"));
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            accountAuthority,
            rememberedReferralCode: "RFL12345",
            findAvailableCode,
          });

          expect(scenario.result?.status).toBe("ready");
          expect(findAvailableCode.mock.calls).toEqual([
            [{ code: "RFL12345" }],
          ]);
          expect(scenario.evaluateCheckoutReferral).not.toHaveBeenCalled();
          expect(await requestedCodeOf(scenario.result)).toBe("RFL12345");
          expect(redirectUrlOf(scenario.result)).not.toContain("RFL12345");
          expect(referralAppliedOf(redirectUrlOf(scenario.result))).toBeNull();
        }
      );

      test.each([
        ["unusable", () => Effect.succeed(undefined)],
        [
          "unreadable",
          () => Effect.fail(new ReferralError({ reason: "unavailable" })),
        ],
      ] as const)(
        "continues a guest checkout without a prefill for an %s code",
        async (_label, lookup) => {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            accountAuthority: { session: null },
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
          accountAuthority: { session: null },
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
          accountAuthority: { session: {}, activityState: "active" },
          customer: "account",
          accountContact: accountContact(),
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
          "a guest",
          {
            accountAuthority: { session: null },
            findAvailableCode: mock(() => Effect.succeed(undefined)),
          },
          "customer-id",
        ],
        [
          "the signed-in account",
          {
            accountAuthority: { session: {}, activityState: "active" },
            customer: "account" as const,
            accountContact: accountContact(),
            linkedAccount: linkedAccount(),
            evaluateCheckoutReferral: mock(() =>
              Effect.succeed({ kind: "already_accepted" as const })
            ),
          },
          accountDotyposCustomerId,
        ],
      ] as const)(
        "forgets the remembered code once %s booked customer is settled",
        async (_label, booking, dotyposCustomerId) => {
          const hasSettledReferral = mock(() => Effect.succeed(true));
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            ...booking,
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
            accountAuthority: { session: {}, activityState: "active" },
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
        [
          "unknown",
          () => Effect.fail(new ReferralError({ reason: "unavailable" })),
        ],
      ] as const)(
        "keeps the remembered code while the booked customer is %s",
        async (_label, settled) => {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            accountAuthority: { session: null },
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
        ["an anonymous guest", { accountAuthority: { session: null } }],
        [
          "the signed-in account",
          {
            accountAuthority: { session: {}, activityState: "active" },
            customer: "account" as const,
            accountContact: accountContact(),
            linkedAccount: linkedAccount(),
          },
        ],
      ] as const)(
        "carries, prefills, and forgets nothing for %s while referrals are withheld",
        async (_label, booking) => {
          const scenario = await runReusableReservationScenario({
            findByAttemptKeys: mock(() => Effect.succeed(null)),
            createDraft: createFreshDraft(),
            ...booking,
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
        accountAuthority: { session: {}, activityState: "active" },
      });

      expect(scenario.result?.status).toBe("ready");
      expect(scenario.readAccountContact).not.toHaveBeenCalled();
      expect(scenario.findOrCreateCustomer).toHaveBeenCalledTimes(1);
      expect(scenario.findOrCreateCustomer.mock.calls[0]?.[0]).toMatchObject({
        email: reservation.email,
        phone: reservation.phone,
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
      expect(scenario.grantInitialMarketingConsent).not.toHaveBeenCalled();
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
        accountAuthority: { session: {}, activityState: "active" },
        customer: "account",
        accountContact: Effect.succeed({
          accountId: "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01",
          dotyposCustomerId: "60111",
          name: "Grace Hopper",
          email: testEmailAddress("grace"),
          phone: "+420 602 123 456",
        } as never),
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

  test("cancels the previous hold before creating a replacement in the same checkout session", async () => {
    const previousReservation = makeReusableReservation({
      id: "previous-reservation-id",
      dotyposReservationId: "previous-dotypos-reservation-id",
    });
    const lifecycleEvents: string[] = [];
    const result = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
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
      ensureAvailable: mock(() =>
        Effect.sync(() => {
          lifecycleEvents.push("recheck-availability");
        })
      ),
      completeSupersessionAndCreateDraft: mock((input) =>
        Effect.sync(() => {
          lifecycleEvents.push("cancel-local-and-create-replacement-draft");
          return makeReusableReservation({
            id: "replacement-reservation-id",
            checkoutSessionKey: input.replacement.checkoutSessionKey,
            checkoutAttemptKey: input.replacement.checkoutAttemptKey,
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
      "previous-reservation-id"
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
      "recheck-availability",
      "cancel-local-and-create-replacement-draft",
      "create-replacement-dotypos-reservation",
    ]);
    expect(result.ensureAvailable).toHaveBeenCalledTimes(1);
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
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(currentLookupCount++ === 0 ? pendingReservation : null)
      ),
      createDraft: mock((input) =>
        Effect.succeed(
          makeReusableReservation({
            id: "rotated-reservation-id",
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
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

  test("keeps the rotated checkout session when superseding its current reservation", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const pendingReservation = makeReusableReservation({
      id: "pending-reservation-id",
      paymentState: "pending",
      activePaymentAttemptId: "payment-attempt-id",
    });
    const rotatedSessionReservation = makeReusableReservation({
      id: "rotated-session-reservation-id",
      dotyposReservationId: "rotated-session-dotypos-reservation-id",
    });
    let currentLookupCount = 0;
    const result = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(
          currentLookupCount++ === 0
            ? pendingReservation
            : rotatedSessionReservation
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
      findByAttemptKeys: mock(() => Effect.succeed(null)),
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
            dotyposReservationId: null,
            reservationState: "draft",
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(markCancellationFailed).toHaveBeenCalledWith({
      id: previousReservation.id,
      failureCode: "checkout_supersession_cancel_failed",
    });
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
      findByAttemptKeys: mock(() => Effect.succeed(null)),
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
            dotyposReservationId: null,
            reservationState: "draft",
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.cancelReservation).not.toHaveBeenCalled();
    expect(result.markCancellationFailed).toHaveBeenCalledWith({
      id: previousReservation.id,
      failureCode: "checkout_supersession_cancel_failed",
    });
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
    const { prepareWorkspacePayState } = await import("./prepare-pay-state");
    const { BotProtectionServiceMock } = await import(
      "@/shared/backend/bot-protection/bot-protection.service.mock"
    );
    const { layer: accountAuthorityLayer } = await accountAuthorityFixture();
    const effect = prepareWorkspacePayState({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: await row.token(),
      reservation: row.reservation,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          accountAuthorityLayer,
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
      findByAttemptKeys: mock(() => Effect.succeed(makeReusableReservation())),
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
    const state = Effect.runSync(openPayState(token ?? ""));
    expect(state.changedKeys?.itemKeys).toContain("product:cowork:open-space");
    expect(state.quote.payment.discounts).toEqual([]);
  });

  test("allows the customer discount to first appear on a ready summary", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const customerQuote = makeAdvertisementQuote(1000, "Customer discount");
    const result = await runReusableReservationScenario({
      findByAttemptKeys: mock(() => Effect.succeed(makeReusableReservation())),
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
    const { layer: accountAuthorityLayer } = await accountAuthorityFixture();
    const effect = prepareWorkspacePayState({
      locale: "en-US",
      checkoutSessionId: "session-id",
      checkoutAttemptId: "attempt-id",
      advertisedPriceToken: "invalid-but-bot-rejects-first",
      reservation,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          accountAuthorityLayer,
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
