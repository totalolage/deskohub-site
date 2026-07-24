import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  DotyposService,
  NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
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
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
  type WorkspaceReservationRepository as WorkspaceReservationRepositoryType,
  WorkspaceReservationStateError,
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

const reusableHoldExpiresAt = Temporal.Instant.from("2030-07-01T12:00:00.000Z");

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
    checkoutSessionKey: "session-key",
    checkoutAttemptKey: "attempt-key",
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
    cancellationClaimOwner: null,
    cancellationClaimedAt: null,
    paidAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    failureCode: null,
    fulfillmentFailureCode: null,
    createdAt: Temporal.Instant.from("2026-07-01T09:55:00.000Z"),
    updatedAt: Temporal.Instant.from("2026-07-01T09:55:00.000Z"),
    ...overrides,
  }) as WorkspaceReservation;

const makeProviderEvidence = (input: {
  readonly id?: string;
  readonly status: "NEW" | "CANCELLED" | "CONFIRMED";
  readonly note: string;
  readonly customerId: string;
}) => {
  const provider = {
    id: input.id,
    _branchId: "synthetic-branch",
    _cloudId: "synthetic-cloud",
    _customerId: input.customerId,
    _tableId: "synthetic-table",
    startDate: "2026-07-01T10:00:00.000Z",
    endDate: "2026-07-01T12:00:00.000Z",
    seats: "2",
    status: input.status,
  };
  const evidence = createHash("sha256")
    .update(
      JSON.stringify([
        provider._branchId,
        provider._cloudId,
        provider._customerId,
        provider._tableId,
        Date.parse(provider.startDate),
        Date.parse(provider.endDate),
        Number(provider.seats),
        "NEW",
        input.note,
      ])
    )
    .digest("base64url");
  return {
    ...provider,
    note: `${input.note}\nProvider request evidence: ${evidence}`,
  };
};

const runReusableReservationScenario = async (input: {
  readonly findByAttemptKey: ReturnType<typeof mock>;
  readonly findCurrentByCheckoutSessionKey?: ReturnType<typeof mock>;
  readonly acquireDraft?: ReturnType<typeof mock>;
  readonly claimHoldCreation?: ReturnType<typeof mock>;
  readonly beginProviderHoldCreation?: ReturnType<typeof mock>;
  readonly reclaimPreProviderHoldCreation?: ReturnType<typeof mock>;
  readonly reclaimStalePreProviderHoldCreation?: ReturnType<typeof mock>;
  readonly retirePreProviderDraft?: ReturnType<typeof mock>;
  readonly requireHoldCreationRecovery?: ReturnType<typeof mock>;
  readonly claimHoldCreationCompensation?: ReturnType<typeof mock>;
  readonly findById?: ReturnType<typeof mock>;
  readonly attachHold?: ReturnType<typeof mock>;
  readonly recordProviderHoldCandidate?: ReturnType<typeof mock>;
  readonly releaseHoldCreation?: ReturnType<typeof mock>;
  readonly markAttachFailedCancellationRequired?: ReturnType<typeof mock>;
  readonly claimSupersessionCancellation?: ReturnType<typeof mock>;
  readonly renewCancellationClaim?: ReturnType<typeof mock>;
  readonly completeSupersessionAndCreateDraft?: ReturnType<typeof mock>;
  readonly cancelReservation?: ReturnType<typeof mock>;
  readonly prepareReservationCreation?: ReturnType<typeof mock>;
  readonly createReservation?: ReturnType<typeof mock>;
  readonly listReservations?: ReturnType<typeof mock>;
  readonly getReservationStatus?: ReturnType<typeof mock>;
  readonly markCancellationFailed?: ReturnType<typeof mock>;
  readonly findOrCreateCustomer?: ReturnType<typeof mock>;
  readonly advertisedPriceToken?: string;
  readonly affirmAdvertisement?: ReturnType<typeof mock>;
  readonly quoteForCustomer?: ReturnType<typeof mock>;
  readonly enqueueCleanup?: ReturnType<typeof mock>;
  readonly scenarioTimeout?: `${number} millis`;
  readonly recordDifferentProviderAttachmentRecovery?: ReturnType<typeof mock>;
  readonly completeDifferentProviderAttachmentRecovery?: ReturnType<
    typeof mock
  >;
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

  const enqueueCleanup = input.enqueueCleanup ?? mock(() => Effect.void);
  const updateReservationDetails = mock(() => Effect.void);
  const recordMany = mock((events) => Effect.succeed(events as never));
  const ensureAvailable = mock(() => Effect.void);
  const verifyHuman = mock(() => Effect.void);
  let latestReservation: WorkspaceReservation | null = null;
  const findByAttemptKey = mock((key: string) =>
    input.findByAttemptKey(key).pipe(
      Effect.tap((reservation) =>
        Effect.sync(() => {
          latestReservation = reservation;
        })
      )
    )
  );
  const acquireDraftSource =
    input.acquireDraft ?? mock(() => Effect.die("unused"));
  const acquireDraft = mock((draftInput) =>
    acquireDraftSource(draftInput).pipe(
      Effect.tap((acquisition) =>
        Effect.sync(() => {
          latestReservation = acquisition.reservation;
        })
      )
    )
  );
  const claimHoldCreation =
    input.claimHoldCreation ??
    mock(() => Effect.succeed("test-provider-epoch"));
  const beginProviderHoldCreation =
    input.beginProviderHoldCreation ?? mock(() => Effect.succeed(true));
  const reclaimPreProviderHoldCreation =
    input.reclaimPreProviderHoldCreation ?? mock(() => Effect.succeed(false));
  const reclaimStalePreProviderHoldCreation =
    input.reclaimStalePreProviderHoldCreation ??
    mock(() => Effect.succeed(false));
  const retirePreProviderDraft =
    input.retirePreProviderDraft ?? mock(() => Effect.succeed(true));
  const requireHoldCreationRecovery =
    input.requireHoldCreationRecovery ?? mock(() => Effect.void);
  const claimHoldCreationCompensation =
    input.claimHoldCreationCompensation ?? mock(() => Effect.succeed(true));
  const findById =
    input.findById ?? mock(() => Effect.sync(() => latestReservation));
  const attachHoldSource = input.attachHold ?? mock(() => Effect.void);
  const recordProviderHoldCandidate =
    input.recordProviderHoldCandidate ?? mock(() => Effect.void);
  const attachHold = mock((attachInput) =>
    attachHoldSource(attachInput).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (!latestReservation) return;
          latestReservation = makeReusableReservation({
            ...latestReservation,
            dotyposReservationId: attachInput.dotyposReservationId,
            reservationCreatedAt: attachInput.reservationCreatedAt,
            reservationState: "held",
            failureCode: `hold_creation_attached:${attachInput.epoch}`,
          });
        })
      )
    )
  );
  const releaseHoldCreation =
    input.releaseHoldCreation ?? mock(() => Effect.void);
  const markAttachFailedCancellationRequired =
    input.markAttachFailedCancellationRequired ?? mock(() => Effect.void);
  const recordDifferentProviderAttachmentRecovery =
    input.recordDifferentProviderAttachmentRecovery ?? mock(() => Effect.void);
  const completeDifferentProviderAttachmentRecovery =
    input.completeDifferentProviderAttachmentRecovery ??
    mock(() => Effect.void);
  const claimSupersessionCancellation =
    input.claimSupersessionCancellation ?? mock(() => Effect.succeed(null));
  const renewCancellationClaim =
    input.renewCancellationClaim ??
    mock(() => Effect.succeed(makeReusableReservation()));
  const completeSupersessionAndCreateDraftSource =
    input.completeSupersessionAndCreateDraft ??
    mock(() => Effect.die("unused"));
  const completeSupersessionAndCreateDraft = mock((replacementInput) =>
    completeSupersessionAndCreateDraftSource(replacementInput).pipe(
      Effect.tap((reservation) =>
        Effect.sync(() => {
          latestReservation = reservation;
        })
      )
    )
  );
  const cancelReservation = input.cancelReservation ?? mock(() => Effect.void);
  const createReservation =
    input.createReservation ??
    mock(() => Effect.succeed({ id: "new-dotypos-reservation-id" } as never));
  const prepareReservationCreation =
    input.prepareReservationCreation ??
    mock(() => Effect.succeed({ request: {} } as never));
  const listReservations =
    input.listReservations ?? mock(() => Effect.succeed([]));
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
      findByAttemptKey,
      findCurrentByCheckoutSessionKey:
        input.findCurrentByCheckoutSessionKey ??
        mock(() => Effect.succeed(null)),
      acquireDraft,
      claimHoldCreation,
      beginProviderHoldCreation,
      reclaimPreProviderHoldCreation,
      reclaimStalePreProviderHoldCreation,
      retirePreProviderDraft,
      requireHoldCreationRecovery,
      claimHoldCreationCompensation,
      findById,
      releaseHoldCreation,
      updateReservationDetails,
      attachHold,
      recordAttachmentCancellationHandoff: mock(() =>
        Effect.succeed(makeReusableReservation())
      ),
      recordProviderHoldCandidate,
      markAttachFailedCancellationRequired,
      recordDifferentProviderAttachmentRecovery,
      completeDifferentProviderAttachmentRecovery,
      claimSupersessionCancellation,
      renewCancellationClaim,
      completeSupersessionAndCreateDraft,
      markCancelled: mock(() => Effect.void),
      markCancellationFailed,
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
      prepareReservationCreation,
      createPreparedReservation: createReservation,
      createReservation,
      listReservations,
    } as unknown as typeof DotyposService.Service)
  );

  const program = prepareWorkspacePayState({
    locale: "en-US",
    checkoutSessionId: "session-id",
    checkoutAttemptId: "attempt-id",
    advertisedPriceToken:
      input.advertisedPriceToken ?? (await buildAdvertisedPriceToken()),
    reservation,
    legalConsent: true,
  }).pipe(Effect.provide(testLayer));
  const result = await (input.scenarioTimeout
    ? program.pipe(Effect.timeout(input.scenarioTimeout))
    : program
  ).pipe(Effect.runPromise);

  return {
    result,
    enqueueCleanup,
    updateReservationDetails,
    recordMany,
    ensureAvailable,
    acquireDraft,
    claimHoldCreation,
    beginProviderHoldCreation,
    reclaimPreProviderHoldCreation,
    reclaimStalePreProviderHoldCreation,
    requireHoldCreationRecovery,
    claimHoldCreationCompensation,
    findById,
    attachHold,
    releaseHoldCreation,
    markAttachFailedCancellationRequired,
    recordDifferentProviderAttachmentRecovery,
    completeDifferentProviderAttachmentRecovery,
    claimSupersessionCancellation,
    renewCancellationClaim,
    completeSupersessionAndCreateDraft,
    cancelReservation,
    prepareReservationCreation,
    createReservation,
    listReservations,
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
  const providerEpoch = "meeting-room-provider-epoch";
  let persistedReservation: WorkspaceReservation | null = null;
  const createDraft = mock((input) =>
    Effect.sync(() => {
      persistedReservation = makeReusableReservation({
        ...input,
        id: "meeting-room-reservation-id",
        dotyposReservationId: null,
        reservationCreatedAt: null,
        reservationState: "draft",
        reservationDetails: input.reservationDetails,
      });
      return persistedReservation;
    })
  );
  const acquireDraft = mock((input) =>
    createDraft(input).pipe(
      Effect.map((createdReservation) =>
        ReservationDraftAcquisition.created({
          reservation: createdReservation,
        })
      )
    )
  );
  const assignTableId = mock(() => Effect.succeed("meeting-room-table-id"));
  const prepareReservationCreation = mock((input) =>
    Effect.succeed(input as never)
  );
  const createReservation = mock(() =>
    Effect.succeed({ id: "dotypos-meeting-room-id" } as never)
  );
  const attachHold = mock((input) =>
    Effect.sync(() => {
      if (!persistedReservation) return;
      persistedReservation = makeReusableReservation({
        ...persistedReservation,
        dotyposReservationId: input.dotyposReservationId,
        reservationCreatedAt: input.reservationCreatedAt,
        reservationState: "held",
        failureCode: `hold_creation_attached:${input.epoch}`,
      });
    })
  );
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
      findByAttemptKey: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(null)),
      acquireDraft,
      claimHoldCreation: mock(() => Effect.succeed(providerEpoch)),
      beginProviderHoldCreation: mock(() => Effect.succeed(true)),
      reclaimPreProviderHoldCreation: mock(() => Effect.succeed(false)),
      reclaimStalePreProviderHoldCreation: mock(() => Effect.succeed(false)),
      requireHoldCreationRecovery: mock(() => Effect.void),
      claimHoldCreationCompensation: mock(() => Effect.succeed(true)),
      recordProviderHoldCandidate: mock(() => Effect.void),
      attachHold,
      findById: mock(() => Effect.sync(() => persistedReservation)),
      releaseHoldCreation: mock(() => Effect.void),
      updateReservationDetails: mock(() => Effect.die("unused")),
      markAttachFailedCancellationRequired: mock(() => Effect.void),
      claimSupersessionCancellation: mock(() => Effect.succeed(null)),
      completeSupersessionAndCreateDraft: mock(() => Effect.die("unused")),
      markCancelled: mock(() => Effect.void),
      markCancellationFailed: mock(() => Effect.void),
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
      prepareReservationCreation,
      createPreparedReservation: createReservation,
      createReservation,
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
        startDate: new Date(startsAt),
        endDate: new Date(endsAt),
        tableId: "meeting-room-table-id",
        status: "NEW",
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
    expect(scenario.enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        recoveryKind: "attachment_unknown",
        orderId: "meeting-room-reservation-id",
        providerCreationEpoch: "meeting-room-provider-epoch",
        dotyposReservationId: "dotypos-meeting-room-id",
      })
    );
    expect(scenario.enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "hold_expired",
        orderId: "meeting-room-reservation-id",
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
});

const runPreProviderExitRetryScenario = async (input: {
  readonly exit: "timeout" | "defect" | "typed_failure";
  readonly reclaimFailures?: number;
}) => {
  const epoch = "pre-provider-retry-epoch";
  let persistedReservation = makeReusableReservation({
    id: "pre-provider-retry-reservation-id",
    dotyposCustomerId: "persisted-pre-provider-retry-customer-id",
    dotyposReservationId: null,
    reservationState: "draft",
  });
  let claimPhase: "draft" | "pre_provider" | "provider" = "draft";
  let quoteAttempt = 0;
  let remainingReclaimFailures = input.reclaimFailures ?? 0;

  const claimHoldCreation = mock(() =>
    Effect.sync(() => {
      if (claimPhase !== "draft") return null;
      claimPhase = "pre_provider";
      persistedReservation = makeReusableReservation({
        ...persistedReservation,
        dotyposReservationId: null,
        reservationState: "creating_hold",
        failureCode: `hold_creation_pre_provider:${epoch}`,
      });
      return epoch;
    })
  );
  const beginProviderHoldCreation = mock(() =>
    Effect.sync(() => {
      if (claimPhase !== "pre_provider") return false;
      claimPhase = "provider";
      return true;
    })
  );
  const reclaimPreProviderHoldCreation = mock(() => {
    if (remainingReclaimFailures > 0) {
      remainingReclaimFailures -= 1;
      return Effect.fail(new Error("Synthetic reclaim update failure"));
    }
    return Effect.sync(() => {
      if (claimPhase !== "pre_provider") return false;
      claimPhase = "draft";
      persistedReservation = makeReusableReservation({
        ...persistedReservation,
        dotyposReservationId: null,
        reservationState: "draft",
        failureCode: null,
      });
      return true;
    });
  });
  const quoteForCustomer = mock(({ affirmedAdvertisement }) => {
    quoteAttempt += 1;
    if (quoteAttempt > 1) {
      return Effect.succeed(buildQuoteFromAdvertisement(affirmedAdvertisement));
    }
    if (input.exit === "timeout") {
      return Effect.never.pipe(Effect.timeout("10 millis"));
    }
    if (input.exit === "defect") {
      return Effect.die(new Error("Synthetic pre-provider defect"));
    }
    return Effect.fail(new Error("Synthetic pre-provider typed failure"));
  });
  const createReservation = mock(() =>
    Effect.succeed({ id: "pre-provider-retry-provider-id" } as never)
  );
  const attachHold = mock((attachment) =>
    Effect.sync(() => {
      persistedReservation = makeReusableReservation({
        ...persistedReservation,
        dotyposReservationId: attachment.dotyposReservationId,
        reservationState: "held",
        reservationCreatedAt: attachment.reservationCreatedAt,
        failureCode: `hold_creation_attached:${attachment.epoch}`,
      });
    })
  );
  const scenario = {
    findByAttemptKey: mock(() => Effect.sync(() => persistedReservation)),
    findById: mock(() => Effect.sync(() => persistedReservation)),
    claimHoldCreation,
    beginProviderHoldCreation,
    reclaimPreProviderHoldCreation,
    reclaimStalePreProviderHoldCreation: reclaimPreProviderHoldCreation,
    quoteForCustomer,
    createReservation,
    attachHold,
  };

  await expect(runReusableReservationScenario(scenario)).rejects.toBeDefined();
  const phaseAfterFailure = claimPhase;
  const retry = await runReusableReservationScenario(scenario);

  return {
    retry,
    phaseAfterFailure,
    claimHoldCreation,
    beginProviderHoldCreation,
    reclaimPreProviderHoldCreation,
    quoteForCustomer,
    createReservation,
  };
};

const runProviderBoundaryReconciliationScenario = async (input: {
  readonly exit: "network" | "missing_id" | "defect";
}) => {
  const epoch = `provider-reconciliation-${input.exit}-epoch`;
  const reservationId = `provider-reconciliation-${input.exit}`;
  const providerReservationId = `provider-reservation-${input.exit}`;
  let persistedReservation = makeReusableReservation({
    id: reservationId,
    dotyposCustomerId: "persisted-provider-reconciliation-customer-id",
    dotyposReservationId: null,
    reservationState: "draft",
    failureCode: null,
  });
  let providerRequestCount = 0;

  const claimHoldCreation = mock(() =>
    Effect.sync(() => {
      if (persistedReservation.reservationState !== "draft") return null;
      persistedReservation = makeReusableReservation({
        ...persistedReservation,
        dotyposReservationId: null,
        reservationState: "creating_hold",
        failureCode: `hold_creation_pre_provider:${epoch}`,
      });
      return epoch;
    })
  );
  const beginProviderHoldCreation = mock(() =>
    Effect.sync(() => {
      if (
        persistedReservation.reservationState !== "creating_hold" ||
        persistedReservation.failureCode !==
          `hold_creation_pre_provider:${epoch}`
      ) {
        return false;
      }
      persistedReservation = makeReusableReservation({
        ...persistedReservation,
        failureCode: `hold_creation_provider_reconciliation:${epoch}`,
      });
      return true;
    })
  );
  const reclaimPreProviderHoldCreation = mock(() =>
    Effect.sync(() => {
      if (
        persistedReservation.reservationState !== "creating_hold" ||
        persistedReservation.failureCode !==
          `hold_creation_pre_provider:${epoch}`
      ) {
        return false;
      }
      persistedReservation = makeReusableReservation({
        ...persistedReservation,
        reservationState: "draft",
        failureCode: null,
      });
      return true;
    })
  );
  const attachHold = mock(
    (attachment: {
      readonly dotyposReservationId: string;
      readonly reservationCreatedAt: Temporal.Instant;
    }) =>
      Effect.sync(() => {
        persistedReservation = makeReusableReservation({
          ...persistedReservation,
          dotyposReservationId: attachment.dotyposReservationId,
          reservationState: "held",
          reservationCreatedAt: attachment.reservationCreatedAt,
          failureCode: `hold_creation_attached:${epoch}`,
        });
      })
  );
  const createReservation = mock(() => {
    providerRequestCount += 1;
    if (input.exit === "network") {
      return Effect.fail(
        new NetworkError({ message: "Synthetic ambiguous network failure" })
      );
    }
    if (input.exit === "defect") {
      return Effect.die(new Error("Synthetic provider boundary defect"));
    }
    return Effect.succeed({ status: "NEW" } as never);
  });
  const listReservations = mock(() =>
    Effect.succeed([
      makeProviderEvidence({
        id: providerReservationId,
        status: "NEW",
        note: `Payment order: ${reservationId}\nProvider creation epoch: ${epoch}`,
        customerId: "persisted-provider-reconciliation-customer-id",
      }),
    ] as never)
  );
  const scenario = {
    findByAttemptKey: mock(() => Effect.sync(() => persistedReservation)),
    findById: mock(() => Effect.sync(() => persistedReservation)),
    claimHoldCreation,
    beginProviderHoldCreation,
    reclaimPreProviderHoldCreation,
    attachHold,
    createReservation,
    listReservations,
  };

  await expect(runReusableReservationScenario(scenario)).rejects.toBeDefined();
  const persistedAfterAmbiguity = persistedReservation;
  const retry = await runReusableReservationScenario(scenario);

  return {
    retry,
    persistedAfterAmbiguity,
    providerRequestCount,
    beginProviderHoldCreation,
    reclaimPreProviderHoldCreation,
    attachHold,
    createReservation,
    listReservations,
  };
};

describe("prepareWorkspacePayState", () => {
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
    const acquireDraft = mock((input) =>
      Effect.succeed(
        ReservationDraftAcquisition.created({
          reservation: {
            id: "reservation-id",
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            correlationId: "correlation-id",
            reservationState: "draft",
            paymentState: "not_started",
            fulfillmentState: "not_started",
            dotyposCustomerId: input.dotyposCustomerId,
            dotyposReservationId: null,
            customerAccessCode: input.customerAccessCode,
            reservationDetails: input.reservationDetails,
            productTier: "basic",
            productCoffee: false,
            productMonitorOption: null,
            locale: input.locale,
            reservationHoldExpiresAt: input.reservationHoldExpiresAt,
          },
        } as never)
      )
    );
    const claimHoldCreation = mock(() =>
      Effect.succeed("created-reservation-epoch")
    );
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
    const recordMany = mock((input) => Effect.succeed(input as never));
    const prepareReservationCreation = mock((input) =>
      Effect.sync(() => {
        eventOrder.push("provider-prepare");
        return { request: input } as never;
      })
    );
    const createReservation = mock(() =>
      Effect.sync(() => {
        eventOrder.push("provider-post");
        return { id: "dotypos-reservation-id" } as never;
      })
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
        findByAttemptKey: mock(() => Effect.succeed(null)),
        findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(null)),
        acquireDraft,
        claimHoldCreation,
        beginProviderHoldCreation: mock(() =>
          Effect.sync(() => {
            eventOrder.push("provider-boundary");
            return true;
          })
        ),
        reclaimPreProviderHoldCreation: mock(() => Effect.succeed(false)),
        reclaimStalePreProviderHoldCreation: mock(() => Effect.succeed(false)),
        requireHoldCreationRecovery: mock(() => Effect.void),
        claimHoldCreationCompensation: mock(() => Effect.succeed(true)),
        recordProviderHoldCandidate: mock(() =>
          Effect.sync(() => {
            eventOrder.push("provider-evidence");
          })
        ),
        attachHold,
        findById: mock(() =>
          Effect.succeed(
            makeReusableReservation({
              id: "reservation-id",
              dotyposCustomerId: "customer-id",
              dotyposReservationId: "dotypos-reservation-id",
              failureCode: "hold_creation_attached:created-reservation-epoch",
            })
          )
        ),
        releaseHoldCreation: mock(() => Effect.void),
        updateReservationDetails: mock(() => Effect.die("unused")),
        recordAttachmentCancellationHandoff: mock(() =>
          Effect.succeed(makeReusableReservation())
        ),
        claimSupersessionCancellation: mock(() => Effect.succeed(null)),
        completeSupersessionAndCreateDraft: mock(() => Effect.die("unused")),
        markCancelled: mock(() => Effect.void),
        markCancellationFailed: mock(() => Effect.void),
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
        prepareReservationCreation,
        createPreparedReservation: createReservation,
        createReservation,
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
    expect(acquireDraft).toHaveBeenCalledTimes(1);
    expect(claimHoldCreation).toHaveBeenCalledWith("reservation-id");
    expect(assignTableId).toHaveBeenCalledWith({
      kind: "cowork",
      entryTier: "basic",
      date: reservation.date,
      coffee: false,
    });
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(eventOrder.indexOf("provider-prepare")).toBeLessThan(
      eventOrder.indexOf("provider-boundary")
    );
    expect(eventOrder.indexOf("provider-boundary")).toBeLessThan(
      eventOrder.indexOf("provider-post")
    );
    expect(attachHold).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        dotyposReservationId: "dotypos-reservation-id",
      })
    );
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "hold_expired",
      orderId: "reservation-id",
      reservationHoldExpiresAt: expect.any(Temporal.Instant),
    });
    expect(enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        recoveryKind: "attachment_unknown",
        orderId: "reservation-id",
        providerCreationEpoch: expect.any(String),
        dotyposReservationId: "dotypos-reservation-id",
        delaySeconds: 120,
      })
    );
    expect(eventOrder).toEqual([
      "bot-verification",
      "advertisement",
      "customer",
      "availability",
      "quote",
      "provider-prepare",
      "provider-boundary",
      "provider-post",
      "provider-evidence",
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

  test("fresh preparation reaches ready after the repository attaches its provider candidate", async () => {
    const providerEpoch = "fresh-production-candidate-epoch";
    const providerReservationId = "fresh-production-provider-id";
    let persisted = makeReusableReservation({
      id: "fresh-production-reservation-id",
      dotyposReservationId: null,
      reservationState: "draft",
      failureCode: null,
    });
    const fakeDatabase = {
      update: () => ({
        set: (values: Partial<WorkspaceReservation>) => ({
          where: () => ({
            returning: () =>
              Effect.sync(() => {
                persisted = makeReusableReservation({
                  ...persisted,
                  ...values,
                });
                return [{ id: persisted.id }];
              }),
          }),
        }),
      }),
    };
    const DatabaseTest = Layer.succeed(
      WorkspaceDatabase,
      WorkspaceDatabase.of({ db: fakeDatabase as never })
    );
    const RepositoryTest = WorkspaceReservationRepositoryLive.pipe(
      Layer.provide(DatabaseTest)
    );
    const acquireDraft = mock((input) =>
      Effect.sync(() => {
        persisted = makeReusableReservation({
          ...persisted,
          checkoutSessionKey: input.checkoutSessionKey,
          checkoutAttemptKey: input.checkoutAttemptKey,
          dotyposCustomerId: input.dotyposCustomerId,
          reservationDetails: input.reservationDetails,
          locale: input.locale,
          reservationHoldExpiresAt: input.reservationHoldExpiresAt,
        });
        return ReservationDraftAcquisition.created({
          reservation: persisted,
        });
      })
    );
    const claimHoldCreation = mock(() =>
      Effect.sync(() => {
        persisted = makeReusableReservation({
          ...persisted,
          reservationState: "creating_hold",
          failureCode: `hold_creation_pre_provider:${providerEpoch}`,
        });
        return providerEpoch;
      })
    );
    const beginProviderHoldCreation = mock(() =>
      Effect.sync(() => {
        persisted = makeReusableReservation({
          ...persisted,
          reservationState: "creating_hold",
          failureCode: `hold_creation_provider_reconciliation:${providerEpoch}`,
        });
        return true;
      })
    );
    const recordProviderHoldCandidate = mock((input) =>
      Effect.sync(() => {
        persisted = makeReusableReservation({
          ...persisted,
          dotyposReservationId: input.dotyposReservationId,
          reservationCreatedAt: input.reservationCreatedAt,
          reservationState: "creating_hold",
          failureCode: `hold_creation_candidate:${input.epoch}:${input.dotyposReservationId}:${input.reservationCreatedAt.epochMilliseconds}`,
        });
      })
    );
    const attachHold = mock((input) =>
      WorkspaceReservationRepository.pipe(
        Effect.flatMap((repository) => repository.attachHold(input)),
        Effect.provide(RepositoryTest)
      )
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(null)),
        acquireDraft,
        claimHoldCreation,
        beginProviderHoldCreation,
        recordProviderHoldCandidate,
        attachHold,
        findById: mock(() => Effect.sync(() => persisted)),
        createReservation: mock(() =>
          Effect.succeed({ id: providerReservationId } as never)
        ),
      })
    ).resolves.toMatchObject({
      result: { status: "ready" },
    });
  });

  test("canonicalizes the provider customer ID before persistence and requests", async () => {
    const acquireDraft = mock((input) =>
      Effect.succeed(
        ReservationDraftAcquisition.created({
          reservation: makeReusableReservation({
            id: "canonical-provider-id-reservation",
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            dotyposCustomerId: input.dotyposCustomerId,
            dotyposReservationId: null,
            reservationState: "draft",
          }),
        })
      )
    );
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      acquireDraft,
      findOrCreateCustomer: mock(() =>
        Effect.succeed({ id: "  canonical-customer-id  " })
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(acquireDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: "canonical-customer-id",
      })
    );
    expect(result.quoteForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: "canonical-customer-id",
      })
    );
    expect(result.prepareReservationCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "canonical-customer-id",
      })
    );
  });

  test("reuses an immediate retry with idempotent cleanup scheduling", async () => {
    const existingReservation = makeReusableReservation({
      dotyposCustomerId: "persisted-customer-id",
    });
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(existingReservation)),
    });

    expect(result.result.status).toBe("ready");
    expect(result.ensureAvailable).not.toHaveBeenCalled();
    expect(result.enqueueCleanup).toHaveBeenCalledTimes(1);
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

  test("requires cleanup enqueue success before reusing a held reservation", async () => {
    let enqueueAttempt = 0;
    const enqueueCleanup = mock(() => {
      enqueueAttempt += 1;
      return enqueueAttempt === 1
        ? Effect.fail(new Error("Synthetic cleanup enqueue failure"))
        : Effect.void;
    });
    const scenario = {
      findByAttemptKey: mock(() => Effect.succeed(makeReusableReservation())),
      enqueueCleanup,
    };

    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();
    const retry = await runReusableReservationScenario(scenario);

    expect(retry.result.status).toBe("ready");
    expect(enqueueCleanup).toHaveBeenCalledTimes(2);
    expect(retry.createReservation).not.toHaveBeenCalled();
  });

  test("treats cleanup enqueue timeout as a retryable action failure", async () => {
    let enqueueAttempt = 0;
    const enqueueCleanup = mock(() => {
      enqueueAttempt += 1;
      return enqueueAttempt === 1 ? Effect.never : Effect.void;
    });
    const scenario = {
      findByAttemptKey: mock(() => Effect.succeed(makeReusableReservation())),
      enqueueCleanup,
    };

    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();
    const retry = await runReusableReservationScenario(scenario);

    expect(retry.result.status).toBe("ready");
    expect(enqueueCleanup).toHaveBeenCalledTimes(2);
    expect(retry.createReservation).not.toHaveBeenCalled();
  }, 5_000);

  test("retries cleanup scheduling after attachment without another provider create", async () => {
    const epoch = "cleanup-after-attach-epoch";
    const providerId = "cleanup-after-attach-provider";
    let persisted = makeReusableReservation({
      id: "cleanup-after-attach-reservation",
      dotyposReservationId: null,
      reservationState: "draft",
    });
    let enqueueAttempt = 0;
    const enqueueCleanup = mock(() => {
      enqueueAttempt += 1;
      return enqueueAttempt === 1
        ? Effect.fail(new Error("Synthetic post-attach enqueue failure"))
        : Effect.void;
    });
    const createReservation = mock(() =>
      Effect.succeed({ id: providerId } as never)
    );
    const scenario = {
      findByAttemptKey: mock(() => Effect.sync(() => persisted)),
      findById: mock(() => Effect.sync(() => persisted)),
      claimHoldCreation: mock(() =>
        Effect.sync(() => {
          persisted = makeReusableReservation({
            ...persisted,
            reservationState: "creating_hold",
            failureCode: `hold_creation_pre_provider:${epoch}`,
          });
          return epoch;
        })
      ),
      beginProviderHoldCreation: mock(() =>
        Effect.sync(() => {
          persisted = makeReusableReservation({
            ...persisted,
            failureCode: `hold_creation_provider_reconciliation:${epoch}`,
          });
          return true;
        })
      ),
      attachHold: mock(() =>
        Effect.sync(() => {
          persisted = makeReusableReservation({
            ...persisted,
            dotyposReservationId: providerId,
            reservationState: "held",
            failureCode: `hold_creation_attached:${epoch}`,
          });
        })
      ),
      reclaimPreProviderHoldCreation: mock(() => Effect.succeed(false)),
      createReservation,
      enqueueCleanup,
    };

    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();
    expect(persisted).toMatchObject({
      reservationState: "held",
      dotyposReservationId: providerId,
    });
    const retry = await runReusableReservationScenario(scenario);

    expect(retry.result.status).toBe("ready");
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(enqueueCleanup).toHaveBeenCalledTimes(2);
  });

  test("schedules a definitive hold after losing the hold-creation claim", async () => {
    const draft = makeReusableReservation({
      id: "lost-claim-cleanup-reservation",
      dotyposReservationId: null,
      reservationState: "draft",
    });
    const definitive = makeReusableReservation({
      ...draft,
      dotyposReservationId: "lost-claim-cleanup-provider",
      reservationState: "held",
      failureCode: "hold_creation_attached:lost-claim-cleanup-epoch",
    });
    const enqueueCleanup = mock(() => Effect.void);
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(draft)),
      claimHoldCreation: mock(() => Effect.succeed(null)),
      findById: mock(() => Effect.succeed(definitive)),
      enqueueCleanup,
    });

    expect(result.result.status).toBe("ready");
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "hold_expired",
      orderId: definitive.id,
      reservationHoldExpiresAt: definitive.reservationHoldExpiresAt,
    });
    expect(result.createReservation).not.toHaveBeenCalled();
  });

  test("preserves the persisted draft hold deadline through attachment and cleanup", async () => {
    const persistedDeadline = Temporal.Instant.from("2099-07-01T09:59:00Z");
    const draft = makeReusableReservation({
      id: "immutable-deadline-reservation",
      dotyposReservationId: null,
      reservationState: "draft",
      reservationHoldExpiresAt: persistedDeadline,
    });
    const attachHold = mock(() => Effect.void);
    const enqueueCleanup = mock(() => Effect.void);
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(draft)),
      attachHold,
      enqueueCleanup,
    });

    expect(result.result.status).toBe("ready");
    expect(attachHold.mock.calls[0]?.[0]).not.toHaveProperty(
      "reservationHoldExpiresAt"
    );
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "hold_expired",
      orderId: draft.id,
      reservationHoldExpiresAt: persistedDeadline,
    });
  });

  test("reuses a held reservation returned by a conflicting draft insert", async () => {
    const claimConflictReservation = makeReusableReservation({
      id: "claim-conflict-reservation-id",
      dotyposCustomerId: "persisted-conflict-customer-id",
    });
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      acquireDraft: mock((input) =>
        Effect.succeed(
          ReservationDraftAcquisition.existing_attempt({
            reservation: {
              ...claimConflictReservation,
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
            },
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.claimHoldCreation).not.toHaveBeenCalled();
    expect(result.findById).toHaveBeenCalledTimes(1);
    expect(result.enqueueCleanup).toHaveBeenCalledTimes(1);
    expect(result.quoteForCustomer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dotyposCustomerId: claimConflictReservation.dotyposCustomerId,
      })
    );
  });

  test("waits for an insertion-conflict attempt transition before reusing its definitive hold", async () => {
    const creatingReservation = makeReusableReservation({
      id: "insertion-conflict-reservation-id",
      dotyposCustomerId: "persisted-insertion-conflict-customer-id",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: "hold_creation_pre_provider:live-insertion-conflict-epoch",
      updatedAt: Temporal.Instant.from("2030-07-01T09:55:00.000Z"),
    });
    const heldReservation = makeReusableReservation({
      ...creatingReservation,
      dotyposReservationId: "insertion-conflict-provider-reservation-id",
      reservationState: "held",
    });
    let persistedReservation = creatingReservation;
    let lookupCount = 0;
    const findById = mock(() =>
      Effect.sync(() => {
        lookupCount += 1;
        const observedReservation = persistedReservation;
        persistedReservation = heldReservation;
        return observedReservation;
      })
    );
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      acquireDraft: mock(() =>
        Effect.succeed(
          ReservationDraftAcquisition.existing_attempt({
            reservation: creatingReservation,
          })
        )
      ),
      findById,
    });

    expect(result.result.status).toBe("ready");
    expect(lookupCount).toBe(3);
    expect(result.claimHoldCreation).not.toHaveBeenCalled();
    expect(result.createReservation).not.toHaveBeenCalled();
    expect(result.reclaimStalePreProviderHoldCreation).not.toHaveBeenCalled();
    expect(result.quoteForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: heldReservation.dotyposCustomerId,
      })
    );
  });

  test("releases a claimed draft after quote failure so the exact attempt can retry", async () => {
    const epoch = "quote-retry-epoch";
    let persistedReservation = makeReusableReservation({
      id: "quote-retry-reservation-id",
      dotyposCustomerId: "persisted-quote-retry-customer-id",
      dotyposReservationId: null,
      reservationState: "draft",
    });
    let quoteAttempt = 0;
    let providerBoundaryStarted = false;
    const claimHoldCreation = mock(() =>
      Effect.sync(() => {
        if (persistedReservation.reservationState !== "draft") return null;
        providerBoundaryStarted = false;
        persistedReservation = makeReusableReservation({
          ...persistedReservation,
          dotyposReservationId: null,
          reservationState: "creating_hold",
          failureCode: `hold_creation_pre_provider:${epoch}`,
        });
        return epoch;
      })
    );
    const reclaimPreProviderHoldCreation = mock(() =>
      Effect.sync(() => {
        if (providerBoundaryStarted) return false;
        if (persistedReservation.reservationState !== "creating_hold") {
          throw new Error("Expected an owned creating-hold claim");
        }
        persistedReservation = makeReusableReservation({
          ...persistedReservation,
          dotyposReservationId: null,
          reservationState: "draft",
          failureCode: null,
        });
        return true;
      })
    );
    const beginProviderHoldCreation = mock(() =>
      Effect.sync(() => {
        if (persistedReservation.reservationState !== "creating_hold") {
          return false;
        }
        providerBoundaryStarted = true;
        return true;
      })
    );
    const quoteForCustomer = mock(({ affirmedAdvertisement }) => {
      quoteAttempt += 1;
      return quoteAttempt === 1
        ? Effect.fail(new Error("Synthetic quote failure"))
        : Effect.succeed(buildQuoteFromAdvertisement(affirmedAdvertisement));
    });
    const createReservation = mock(() =>
      Effect.succeed({ id: "quote-retry-provider-reservation-id" } as never)
    );
    const scenario = {
      findByAttemptKey: mock(() => Effect.sync(() => persistedReservation)),
      claimHoldCreation,
      beginProviderHoldCreation,
      reclaimPreProviderHoldCreation,
      quoteForCustomer,
      createReservation,
    };

    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();

    expect(persistedReservation.reservationState).toBe("draft");
    expect(reclaimPreProviderHoldCreation).toHaveBeenCalledTimes(1);
    expect(createReservation).not.toHaveBeenCalled();

    const retry = await runReusableReservationScenario(scenario);

    expect(retry.result.status).toBe("ready");
    expect(claimHoldCreation).toHaveBeenCalledTimes(2);
    expect(reclaimPreProviderHoldCreation).toHaveBeenCalledTimes(2);
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(quoteForCustomer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dotyposCustomerId: persistedReservation.dotyposCustomerId,
      })
    );
  });

  test.each([
    "validation",
    "authentication",
  ] as const)("keeps provider %s failure before the durable boundary retryable", async (failureKind) => {
    const draft = makeReusableReservation({
      id: `provider-preparation-${failureKind}`,
      dotyposReservationId: null,
      reservationState: "draft",
    });
    const beginProviderHoldCreation = mock(() => Effect.succeed(true));
    const reclaimPreProviderHoldCreation = mock(() => Effect.succeed(true));
    const createReservation = mock(() =>
      Effect.succeed({ id: "unused-provider-id" } as never)
    );
    const prepareReservationCreation = mock(() =>
      Effect.fail(
        failureKind === "validation"
          ? new ValidationError({
              message: "Synthetic deterministic validation failure",
            })
          : new NetworkError({
              message: "Synthetic authentication setup failure",
            })
      )
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(draft)),
        claimHoldCreation: mock(() =>
          Effect.succeed(`provider-preparation-${failureKind}-epoch`)
        ),
        beginProviderHoldCreation,
        reclaimPreProviderHoldCreation,
        prepareReservationCreation,
        createReservation,
      })
    ).rejects.toBeDefined();

    expect(prepareReservationCreation).toHaveBeenCalledTimes(1);
    expect(beginProviderHoldCreation).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
    expect(reclaimPreProviderHoldCreation).toHaveBeenCalledTimes(1);
  });

  test("reclaims an interrupted pre-provider claim and retries the exact attempt", async () => {
    const result = await runPreProviderExitRetryScenario({ exit: "timeout" });

    expect(result.phaseAfterFailure).toBe("draft");
    expect(result.retry.result.status).toBe("ready");
    expect(result.claimHoldCreation).toHaveBeenCalledTimes(2);
    expect(result.beginProviderHoldCreation).toHaveBeenCalledTimes(1);
    expect(result.reclaimPreProviderHoldCreation).toHaveBeenCalledTimes(2);
    expect(result.createReservation).toHaveBeenCalledTimes(1);
  });

  test("reclaims a defected pre-provider claim and retries the exact attempt", async () => {
    const result = await runPreProviderExitRetryScenario({ exit: "defect" });

    expect(result.phaseAfterFailure).toBe("draft");
    expect(result.retry.result.status).toBe("ready");
    expect(result.claimHoldCreation).toHaveBeenCalledTimes(2);
    expect(result.beginProviderHoldCreation).toHaveBeenCalledTimes(1);
    expect(result.reclaimPreProviderHoldCreation).toHaveBeenCalledTimes(2);
    expect(result.createReservation).toHaveBeenCalledTimes(1);
  });

  test("recovers an exact retry after pre-provider compensation persistence fails", async () => {
    const result = await runPreProviderExitRetryScenario({
      exit: "typed_failure",
      reclaimFailures: 1,
    });

    expect(result.phaseAfterFailure).toBe("pre_provider");
    expect(result.retry.result.status).toBe("ready");
    expect(result.claimHoldCreation).toHaveBeenCalledTimes(2);
    expect(result.beginProviderHoldCreation).toHaveBeenCalledTimes(1);
    expect(result.reclaimPreProviderHoldCreation).toHaveBeenCalledTimes(3);
    expect(result.createReservation).toHaveBeenCalledTimes(1);
  });

  test("reconciles an ambiguous network result without a second provider create", async () => {
    const result = await runProviderBoundaryReconciliationScenario({
      exit: "network",
    });

    expect(result.persistedAfterAmbiguity).toMatchObject({
      reservationState: "creating_hold",
      dotyposReservationId: null,
      failureCode:
        "hold_creation_provider_reconciliation:provider-reconciliation-network-epoch",
    });
    expect(result.retry.result.status).toBe("ready");
    expect(result.providerRequestCount).toBe(1);
    expect(result.createReservation).toHaveBeenCalledTimes(1);
    expect(result.listReservations).toHaveBeenCalledTimes(1);
    expect(result.attachHold).toHaveBeenCalledTimes(1);
    expect(result.retry.enqueueCleanup).toHaveBeenCalledTimes(2);
  });

  test("reconciles begin-marker commit ambiguity without issuing a provider create", async () => {
    const epoch = "begin-marker-ambiguity-epoch";
    const providerId = "begin-marker-reconciled-provider-id";
    let persisted = makeReusableReservation({
      id: "begin-marker-ambiguity-reservation",
      dotyposReservationId: null,
      reservationState: "draft",
    });
    const createReservation = mock(() =>
      Effect.succeed({ id: "unused-provider-id" } as never)
    );
    const attachHold = mock(
      (input: { readonly dotyposReservationId: string }) =>
        Effect.sync(() => {
          persisted = makeReusableReservation({
            ...persisted,
            reservationState: "held",
            dotyposReservationId: input.dotyposReservationId,
            failureCode: `hold_creation_attached:${epoch}`,
          });
        })
    );
    let beginAttempt = 0;
    const scenario = {
      findByAttemptKey: mock(() => Effect.sync(() => persisted)),
      findById: mock(() => Effect.sync(() => persisted)),
      claimHoldCreation: mock(() =>
        Effect.sync(() => {
          persisted = makeReusableReservation({
            ...persisted,
            reservationState: "creating_hold",
            failureCode: `hold_creation_pre_provider:${epoch}`,
          });
          return epoch;
        })
      ),
      beginProviderHoldCreation: mock(() =>
        Effect.suspend(() => {
          beginAttempt += 1;
          persisted = makeReusableReservation({
            ...persisted,
            failureCode: `hold_creation_provider_reconciliation:${epoch}`,
          });
          return Effect.fail(
            new Error("Synthetic provider-boundary marker acknowledgement loss")
          );
        })
      ),
      reclaimPreProviderHoldCreation: mock(() => Effect.succeed(false)),
      listReservations: mock(() =>
        Effect.succeed([
          makeProviderEvidence({
            id: providerId,
            status: "NEW",
            note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
            customerId: persisted.dotyposCustomerId,
          }),
        ] as never)
      ),
      attachHold,
      createReservation,
    };

    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();
    const retry = await runReusableReservationScenario(scenario);

    expect(retry.result.status).toBe("ready");
    expect(beginAttempt).toBe(1);
    expect(createReservation).not.toHaveBeenCalled();
    expect(attachHold).toHaveBeenCalledTimes(1);
    expect(retry.enqueueCleanup).toHaveBeenCalledTimes(2);
  });

  test("reconciles a successful provider response without an ID", async () => {
    const result = await runProviderBoundaryReconciliationScenario({
      exit: "missing_id",
    });

    expect(result.persistedAfterAmbiguity.failureCode).toBe(
      "hold_creation_provider_reconciliation:provider-reconciliation-missing_id-epoch"
    );
    expect(result.retry.result.status).toBe("ready");
    expect(result.providerRequestCount).toBe(1);
    expect(result.createReservation).toHaveBeenCalledTimes(1);
    expect(result.listReservations).toHaveBeenCalledTimes(1);
    expect(result.attachHold).toHaveBeenCalledTimes(1);
    expect(result.retry.enqueueCleanup).toHaveBeenCalledTimes(2);
  });

  test("reconciles a provider defect without a second provider create", async () => {
    const result = await runProviderBoundaryReconciliationScenario({
      exit: "defect",
    });

    expect(result.persistedAfterAmbiguity.failureCode).toBe(
      "hold_creation_provider_reconciliation:provider-reconciliation-defect-epoch"
    );
    expect(result.retry.result.status).toBe("ready");
    expect(result.providerRequestCount).toBe(1);
    expect(result.createReservation).toHaveBeenCalledTimes(1);
    expect(result.listReservations).toHaveBeenCalledTimes(1);
    expect(result.attachHold).toHaveBeenCalledTimes(1);
    expect(result.retry.enqueueCleanup).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["zero_matches", []],
    [
      "multiple_matches",
      [
        { id: "synthetic-match-a", status: "NEW" },
        { id: "synthetic-match-b", status: "NEW" },
      ],
    ],
    ["missing_id", [{ id: " ", status: "NEW" }]],
    ["unsafe_status", [{ id: "synthetic-match", status: "CONFIRMED" }]],
  ] as const)("durably classifies %s reconciliation without another provider create", async (reason, matches) => {
    const epoch = `recovery-${reason}-epoch`;
    const pending = makeReusableReservation({
      id: `recovery-${reason}-reservation`,
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    const requireHoldCreationRecovery = mock(() => Effect.void);
    const createReservation = mock(() =>
      Effect.succeed({ id: "unused-provider-id" } as never)
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(pending)),
        findById: mock(() => Effect.succeed(pending)),
        listReservations: mock(() =>
          Effect.succeed(
            matches.map((match) =>
              makeProviderEvidence({
                id: match.id,
                status: match.status,
                note: `Payment order: ${pending.id}\nProvider creation epoch: ${epoch}`,
                customerId: pending.dotyposCustomerId,
              })
            ) as never
          )
        ),
        requireHoldCreationRecovery,
        createReservation,
      })
    ).rejects.toBeDefined();

    expect(requireHoldCreationRecovery).toHaveBeenCalledWith({
      id: pending.id,
      epoch,
      reason,
    });
    expect(createReservation).not.toHaveBeenCalled();
  });

  test("persists read-failure recovery and retries reconciliation without a provider create", async () => {
    const epoch = "reconciliation-read-failure-epoch";
    const pending = makeReusableReservation({
      id: "reconciliation-read-failure-reservation",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    let readAttempt = 0;
    const requireHoldCreationRecovery = mock(() => Effect.void);
    const createReservation = mock(() =>
      Effect.succeed({ id: "unused-provider-id" } as never)
    );
    const scenario = {
      findByAttemptKey: mock(() => Effect.succeed(pending)),
      findById: mock(() => Effect.succeed(pending)),
      listReservations: mock(() => {
        readAttempt += 1;
        return Effect.fail(
          new NetworkError({
            message: `Synthetic reconciliation read failure ${readAttempt}`,
          })
        );
      }),
      requireHoldCreationRecovery,
      createReservation,
    };

    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();
    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();

    expect(requireHoldCreationRecovery).toHaveBeenCalledTimes(2);
    expect(requireHoldCreationRecovery).toHaveBeenLastCalledWith({
      id: pending.id,
      epoch,
      reason: "read_failed",
    });
    expect(createReservation).not.toHaveBeenCalled();
  });

  test("keeps reconciliation retryable when recovery-marker persistence fails", async () => {
    const epoch = "recovery-persistence-failure-epoch";
    const pending = makeReusableReservation({
      id: "recovery-persistence-failure-reservation",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    let markerAttempt = 0;
    const requireHoldCreationRecovery = mock(() => {
      markerAttempt += 1;
      return markerAttempt === 1
        ? Effect.fail(new Error("Synthetic recovery marker failure"))
        : Effect.void;
    });
    const scenario = {
      findByAttemptKey: mock(() => Effect.succeed(pending)),
      findById: mock(() => Effect.succeed(pending)),
      listReservations: mock(() => Effect.succeed([])),
      requireHoldCreationRecovery,
      createReservation: mock(() =>
        Effect.succeed({ id: "unused-provider-id" } as never)
      ),
    };

    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();
    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();

    expect(requireHoldCreationRecovery).toHaveBeenCalledTimes(2);
    expect(scenario.createReservation).not.toHaveBeenCalled();
  });

  test("stale cancelled evidence cannot release a newer provider epoch", async () => {
    const oldEpoch = "stale-cancelled-epoch";
    const newEpoch = "new-provider-epoch";
    let persisted = makeReusableReservation({
      id: "epoch-guard-reservation",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${oldEpoch}`,
    });
    const releaseHoldCreation = mock(({ epoch }: { readonly epoch: string }) =>
      Effect.suspend(() => {
        if (
          persisted.failureCode !==
          `hold_creation_provider_reconciliation:${epoch}`
        ) {
          return Effect.fail(new Error("Synthetic stale epoch conflict"));
        }
        persisted = makeReusableReservation({
          ...persisted,
          reservationState: "draft",
          failureCode: null,
        });
        return Effect.void;
      })
    );
    const listReservations = mock(() =>
      Effect.sync(() => {
        persisted = makeReusableReservation({
          ...persisted,
          failureCode: `hold_creation_provider_reconciliation:${newEpoch}`,
        });
        return [
          makeProviderEvidence({
            id: "synthetic-cancelled-provider-id",
            status: "CANCELLED",
            note: `Payment order: ${persisted.id}\nProvider creation epoch: ${oldEpoch}`,
            customerId: persisted.dotyposCustomerId,
          }),
        ] as never;
      })
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(persisted)),
        findById: mock(() => Effect.sync(() => persisted)),
        listReservations,
        releaseHoldCreation,
      })
    ).rejects.toBeDefined();

    expect(releaseHoldCreation).toHaveBeenCalledWith({
      id: persisted.id,
      epoch: oldEpoch,
    });
    expect(persisted).toMatchObject({
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${newEpoch}`,
    });
  });

  test("ignores epoch-A cancellation until delayed epoch-B evidence is visible", async () => {
    const oldEpoch = "visibility-old-epoch";
    const epoch = "visibility-current-epoch";
    const providerId = "visibility-current-provider";
    let lookupAttempt = 0;
    let persisted = makeReusableReservation({
      id: "visibility-delay-reservation",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    const releaseHoldCreation = mock(() => Effect.void);
    const requireHoldCreationRecovery = mock(
      (input: { readonly reason: string }) =>
        Effect.sync(() => {
          persisted = makeReusableReservation({
            ...persisted,
            failureCode: `hold_creation_recovery_required:${epoch}:${input.reason}`,
          });
        })
    );
    const listReservations = mock(() =>
      Effect.sync(() => {
        lookupAttempt += 1;
        return lookupAttempt === 1
          ? [
              makeProviderEvidence({
                id: "visibility-old-provider",
                status: "CANCELLED",
                note: `Payment order: ${persisted.id}\nProvider creation epoch: ${oldEpoch}`,
                customerId: persisted.dotyposCustomerId,
              }),
            ]
          : [
              makeProviderEvidence({
                id: providerId,
                status: "NEW",
                note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
                customerId: persisted.dotyposCustomerId,
              }),
            ];
      })
    );
    const attachHold = mock(() =>
      Effect.sync(() => {
        persisted = makeReusableReservation({
          ...persisted,
          dotyposReservationId: providerId,
          reservationState: "held",
          failureCode: `hold_creation_attached:${epoch}`,
        });
      })
    );
    const scenario = {
      findByAttemptKey: mock(() => Effect.sync(() => persisted)),
      findById: mock(() => Effect.sync(() => persisted)),
      listReservations,
      requireHoldCreationRecovery,
      releaseHoldCreation,
      attachHold,
      createReservation: mock(() =>
        Effect.succeed({ id: "unused-provider-id" } as never)
      ),
    };

    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();
    expect(releaseHoldCreation).not.toHaveBeenCalled();
    expect(persisted.failureCode).toBe(
      `hold_creation_recovery_required:${epoch}:zero_matches`
    );

    const retry = await runReusableReservationScenario(scenario);
    expect(retry.result.status).toBe("ready");
    expect(attachHold).toHaveBeenCalledTimes(1);
    expect(scenario.createReservation).not.toHaveBeenCalled();
  });

  test("schedules an already-due reconciled hold before refusing reuse", async () => {
    const epoch = "already-due-reconciliation-epoch";
    const providerId = "already-due-provider";
    let persisted = makeReusableReservation({
      id: "already-due-reconciliation-reservation",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
      reservationHoldExpiresAt: Temporal.Instant.from(
        "2000-01-01T00:00:00.000Z"
      ),
    });
    const enqueueCleanup = mock(() => Effect.void);
    const createReservation = mock(() =>
      Effect.succeed({ id: "unused-provider-id" } as never)
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.sync(() => persisted)),
        findById: mock(() => Effect.sync(() => persisted)),
        listReservations: mock(() =>
          Effect.succeed([
            makeProviderEvidence({
              id: providerId,
              status: "NEW",
              note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
              customerId: persisted.dotyposCustomerId,
            }),
          ])
        ),
        attachHold: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              dotyposReservationId: providerId,
              reservationState: "held",
              failureCode: `hold_creation_attached:${epoch}`,
            });
          })
        ),
        enqueueCleanup,
        createReservation,
      })
    ).rejects.toBeDefined();

    expect(enqueueCleanup).toHaveBeenCalledTimes(2);
    expect(createReservation).not.toHaveBeenCalled();
    expect(persisted.reservationState).toBe("held");
  });

  test("treats commit-then-error attachment as success without provider compensation", async () => {
    const epoch = "commit-then-error-epoch";
    const providerId = "commit-then-error-provider-id";
    let persisted = makeReusableReservation({
      id: "commit-then-error-reservation",
      dotyposReservationId: null,
      reservationState: "draft",
      failureCode: null,
    });
    const attachHold = mock(() =>
      Effect.suspend(() => {
        persisted = makeReusableReservation({
          ...persisted,
          dotyposReservationId: providerId,
          reservationState: "held",
          failureCode: `hold_creation_attached:${epoch}`,
        });
        return Effect.fail(
          new Error("Synthetic post-commit acknowledgement loss")
        );
      })
    );
    const claimHoldCreationCompensation = mock(() =>
      Effect.succeed(
        persisted.reservationState === "creating_hold" &&
          persisted.dotyposReservationId === null
      )
    );
    const cancelReservation = mock(() => Effect.void);
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.sync(() => persisted)),
      findById: mock(() => Effect.sync(() => persisted)),
      claimHoldCreation: mock(() =>
        Effect.sync(() => {
          persisted = makeReusableReservation({
            ...persisted,
            reservationState: "creating_hold",
            failureCode: `hold_creation_pre_provider:${epoch}`,
          });
          return epoch;
        })
      ),
      beginProviderHoldCreation: mock(() =>
        Effect.sync(() => {
          persisted = makeReusableReservation({
            ...persisted,
            failureCode: `hold_creation_provider_reconciliation:${epoch}`,
          });
          return true;
        })
      ),
      attachHold,
      claimHoldCreationCompensation,
      cancelReservation,
      createReservation: mock(() =>
        Effect.succeed({ id: providerId } as never)
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(claimHoldCreationCompensation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(result.enqueueCleanup).toHaveBeenCalledTimes(3);
    expect(result.enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        recoveryKind: "attachment_unknown",
        providerCreationEpoch: epoch,
        dotyposReservationId: providerId,
      })
    );
  });

  test("hands exact provider evidence off after an attachment defect", async () => {
    const epoch = "synthetic-attach-defect-epoch";
    const providerId = "synthetic-attach-defect-provider";
    const createReservation = mock(() =>
      Effect.succeed({ id: providerId } as never)
    );
    const recordProviderHoldCandidate = mock(() => Effect.void);
    const enqueueCleanup = mock(() => Effect.void);

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() =>
          Effect.succeed(
            makeReusableReservation({
              id: "synthetic-attach-defect-order",
              dotyposReservationId: null,
              reservationState: "draft",
              failureCode: null,
            })
          )
        ),
        claimHoldCreation: mock(() => Effect.succeed(epoch)),
        attachHold: mock(() => Effect.die("synthetic attachment defect")),
        recordProviderHoldCandidate,
        createReservation,
        enqueueCleanup,
      })
    ).rejects.toBeDefined();

    const evidence = recordProviderHoldCandidate.mock.calls[0]?.[0];
    expect(evidence).toMatchObject({
      epoch,
      dotyposReservationId: providerId,
    });
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        recoveryKind: "attachment_unknown",
        providerCreationEpoch: epoch,
        dotyposReservationId: providerId,
        reservationCreatedAt: evidence.reservationCreatedAt,
      })
    );
  });

  test("hands exact provider evidence off without inline cancellation", async () => {
    const epoch = "synthetic-cancel-defect-epoch";
    const providerId = "synthetic-cancel-defect-provider";
    const recordProviderHoldCandidate = mock(() => Effect.void);
    const cancelReservation = mock(() =>
      Effect.die("synthetic cancellation defect")
    );
    const enqueueCleanup = mock(() => Effect.void);

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() =>
          Effect.succeed(
            makeReusableReservation({
              id: "synthetic-cancel-defect-order",
              dotyposReservationId: null,
              reservationState: "draft",
              failureCode: null,
            })
          )
        ),
        claimHoldCreation: mock(() => Effect.succeed(epoch)),
        recordProviderHoldCandidate,
        attachHold: mock(() =>
          Effect.fail(new Error("synthetic attachment failure"))
        ),
        claimHoldCreationCompensation: mock(() => Effect.succeed(true)),
        cancelReservation,
        enqueueCleanup,
        createReservation: mock(() =>
          Effect.succeed({ id: providerId } as never)
        ),
      })
    ).rejects.toBeDefined();

    expect(recordProviderHoldCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        epoch,
        dotyposReservationId: providerId,
        reservationCreatedAt: expect.any(Temporal.Instant),
      })
    );
    expect(cancelReservation).not.toHaveBeenCalled();
    const evidence = recordProviderHoldCandidate.mock.calls[0]?.[0];
    expect(enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        providerCreationEpoch: epoch,
        dotyposReservationId: providerId,
        reservationCreatedAt: evidence.reservationCreatedAt,
      })
    );
  });

  test("keeps a fresh provider boundary non-payable instead of reconciling concurrently", async () => {
    const epoch = "synthetic-live-provider-boundary-epoch";
    const persisted = makeReusableReservation({
      id: "synthetic-live-provider-boundary-order",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
      updatedAt: Temporal.Now.instant(),
    });
    const listReservations = mock(() =>
      Effect.die("live provider boundary must not be queried")
    );
    const attachHold = mock(() =>
      Effect.die("live provider boundary must not attach")
    );
    const createReservation = mock(() =>
      Effect.die("an exact retry must not create again")
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(persisted)),
        findById: mock(() => Effect.succeed(persisted)),
        listReservations,
        attachHold,
        createReservation,
        scenarioTimeout: "50 millis",
      })
    ).rejects.toBeDefined();

    expect(listReservations).not.toHaveBeenCalled();
    expect(attachHold).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
  });

  test("keeps payment blocked when exact evidence persistence fails before a delayed queue handoff", async () => {
    const epoch = "synthetic-evidence-write-failure-epoch";
    let persisted = makeReusableReservation({
      id: "synthetic-evidence-write-failure-order",
      dotyposReservationId: null,
      reservationState: "draft",
      failureCode: null,
    });
    const createReservation = mock(() =>
      Effect.succeed({
        id: "synthetic-evidence-write-failure-provider",
      } as never)
    );
    const enqueueCleanup = mock(() => Effect.void);
    const attachHold = mock(() =>
      Effect.die("attachment cannot follow failed evidence persistence")
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.sync(() => persisted)),
        findById: mock(() => Effect.sync(() => persisted)),
        claimHoldCreation: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              reservationState: "creating_hold",
              failureCode: `hold_creation_pre_provider:${epoch}`,
            });
            return epoch;
          })
        ),
        beginProviderHoldCreation: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              failureCode: `hold_creation_provider_reconciliation:${epoch}`,
              updatedAt: Temporal.Now.instant(),
            });
            return true;
          })
        ),
        recordProviderHoldCandidate: mock(() =>
          Effect.fail(new Error("synthetic evidence persistence failure"))
        ),
        attachHold,
        createReservation,
        enqueueCleanup,
      })
    ).rejects.toBeDefined();

    expect(persisted).toMatchObject({
      reservationState: "creating_hold",
      paymentState: "not_started",
      activePaymentAttemptId: null,
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(attachHold).not.toHaveBeenCalled();
    expect(enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        providerCreationEpoch: epoch,
      })
    );
  });

  test("durably records a different-provider attachment loser without changing the winner", async () => {
    const epoch = "different-provider-epoch";
    const winnerId = "synthetic-provider-winner";
    const loserId = "synthetic-provider-loser";
    let persisted = makeReusableReservation({
      id: "different-provider-reservation",
      dotyposReservationId: null,
      reservationState: "draft",
    });
    const recordProviderHoldCandidate = mock(
      (input: { readonly dotyposReservationId: string }) =>
        Effect.sync(() => {
          if (
            persisted.reservationState === "held" &&
            persisted.dotyposReservationId !== input.dotyposReservationId
          ) {
            persisted = makeReusableReservation({
              ...persisted,
              failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
            });
          }
        })
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.sync(() => persisted)),
        findById: mock(() => Effect.sync(() => persisted)),
        claimHoldCreation: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              reservationState: "creating_hold",
              failureCode: `hold_creation_pre_provider:${epoch}`,
            });
            return epoch;
          })
        ),
        beginProviderHoldCreation: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              failureCode: `hold_creation_provider_reconciliation:${epoch}`,
            });
            return true;
          })
        ),
        createReservation: mock(() => Effect.succeed({ id: loserId } as never)),
        attachHold: mock(() =>
          Effect.suspend(() => {
            persisted = makeReusableReservation({
              ...persisted,
              reservationState: "held",
              dotyposReservationId: winnerId,
              failureCode: `hold_creation_attached:${epoch}`,
            });
            return Effect.fail(
              new Error("Synthetic concurrent attachment conflict")
            );
          })
        ),
        claimHoldCreationCompensation: mock(() => Effect.succeed(false)),
        recordProviderHoldCandidate,
      })
    ).rejects.toBeDefined();

    expect(persisted).toMatchObject({
      reservationState: "held",
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    expect(recordProviderHoldCandidate).toHaveBeenCalledTimes(2);
  });

  test("hands off a direct attachment loser before a failed definitive reread", async () => {
    const epoch = "direct-reread-failure-epoch";
    const winnerId = "synthetic-direct-reread-winner";
    const loserId = "synthetic-direct-reread-loser";
    let persisted = makeReusableReservation({
      id: "direct-reread-failure-reservation",
      dotyposReservationId: null,
      reservationState: "draft",
    });
    const recordCandidate = mock((input) =>
      Effect.sync(() => {
        if (
          persisted.reservationState === "held" &&
          persisted.dotyposReservationId !== input.dotyposReservationId
        ) {
          persisted = makeReusableReservation({
            ...persisted,
            failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
          });
        }
      })
    );
    const enqueueCleanup = mock(() => Effect.void);

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.sync(() => persisted)),
        findById: mock(() =>
          Effect.fail(new Error("Synthetic definitive reread failure"))
        ),
        claimHoldCreation: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              reservationState: "creating_hold",
              failureCode: `hold_creation_pre_provider:${epoch}`,
            });
            return epoch;
          })
        ),
        beginProviderHoldCreation: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              failureCode: `hold_creation_provider_reconciliation:${epoch}`,
            });
            return true;
          })
        ),
        createReservation: mock(() => Effect.succeed({ id: loserId } as never)),
        attachHold: mock(() =>
          Effect.suspend(() => {
            persisted = makeReusableReservation({
              ...persisted,
              reservationState: "held",
              dotyposReservationId: winnerId,
              failureCode: `hold_creation_attached:${epoch}`,
            });
            return Effect.fail(
              new Error("Synthetic direct attachment conflict")
            );
          })
        ),
        claimHoldCreationCompensation: mock(() => Effect.succeed(false)),
        recordProviderHoldCandidate: recordCandidate,
        enqueueCleanup,
      })
    ).rejects.toBeDefined();

    expect(recordCandidate).toHaveBeenCalledTimes(2);
    expect(enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        recoveryKind: "attachment_unknown",
        providerCreationEpoch: epoch,
        dotyposReservationId: loserId,
      })
    );
    expect(persisted).toMatchObject({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });

    const retryCreate = mock(() =>
      Effect.succeed({ id: "unexpected-retry-provider" } as never)
    );
    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.sync(() => persisted)),
        findById: mock(() => Effect.sync(() => persisted)),
        enqueueCleanup,
        listReservations: mock(() =>
          Effect.succeed([
            makeProviderEvidence({
              id: loserId,
              status: "NEW",
              note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
              customerId: persisted.dotyposCustomerId,
            }),
          ])
        ),
        createReservation: retryCreate,
      })
    ).rejects.toBeDefined();
    expect(retryCreate).not.toHaveBeenCalled();
  });

  test("records a reconciler attachment loser without overwriting the direct winner", async () => {
    const epoch = "reconciler-loser-epoch";
    const winnerId = "synthetic-direct-winner";
    const loserId = "synthetic-reconciler-loser";
    let persisted = makeReusableReservation({
      id: "reconciler-loser-reservation",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    const recordProviderHoldCandidate = mock(
      (input: { readonly dotyposReservationId: string }) =>
        Effect.sync(() => {
          if (
            persisted.reservationState === "held" &&
            persisted.dotyposReservationId !== input.dotyposReservationId
          ) {
            persisted = makeReusableReservation({
              ...persisted,
              failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
            });
          }
        })
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.sync(() => persisted)),
        findById: mock(() => Effect.sync(() => persisted)),
        listReservations: mock(() =>
          Effect.succeed([
            makeProviderEvidence({
              id: loserId,
              status: "NEW",
              note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
              customerId: persisted.dotyposCustomerId,
            }),
          ])
        ),
        attachHold: mock(() =>
          Effect.suspend(() => {
            persisted = makeReusableReservation({
              ...persisted,
              reservationState: "held",
              dotyposReservationId: winnerId,
              failureCode: `hold_creation_attached:${epoch}`,
            });
            return Effect.fail(
              new Error("Synthetic direct-vs-reconciler attach conflict")
            );
          })
        ),
        recordProviderHoldCandidate,
        createReservation: mock(() =>
          Effect.succeed({ id: "unused-provider-id" } as never)
        ),
      })
    ).rejects.toBeDefined();

    expect(persisted).toMatchObject({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    expect(recordProviderHoldCandidate).toHaveBeenCalledTimes(2);
  });

  test("hands off a reconciler attachment loser before a failed definitive reread", async () => {
    const epoch = "reconciler-reread-failure-epoch";
    const winnerId = "synthetic-reconciler-reread-winner";
    const loserId = "synthetic-reconciler-reread-loser";
    let persisted = makeReusableReservation({
      id: "reconciler-reread-failure-reservation",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    const recordCandidate = mock((input) =>
      Effect.sync(() => {
        if (
          persisted.reservationState === "held" &&
          persisted.dotyposReservationId !== input.dotyposReservationId
        ) {
          persisted = makeReusableReservation({
            ...persisted,
            failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
          });
        }
      })
    );
    const enqueueCleanup = mock(() => Effect.void);

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.sync(() => persisted)),
        findById: mock(() =>
          Effect.fail(new Error("Synthetic definitive reread failure"))
        ),
        listReservations: mock(() =>
          Effect.succeed([
            makeProviderEvidence({
              id: loserId,
              status: "NEW",
              note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
              customerId: persisted.dotyposCustomerId,
            }),
          ])
        ),
        attachHold: mock(() =>
          Effect.suspend(() => {
            persisted = makeReusableReservation({
              ...persisted,
              reservationState: "held",
              dotyposReservationId: winnerId,
              failureCode: `hold_creation_attached:${epoch}`,
            });
            return Effect.fail(
              new Error("Synthetic reconciler attachment conflict")
            );
          })
        ),
        recordProviderHoldCandidate: recordCandidate,
        enqueueCleanup,
        createReservation: mock(() =>
          Effect.succeed({ id: "unused-provider-id" } as never)
        ),
      })
    ).rejects.toBeDefined();

    expect(recordCandidate).toHaveBeenCalledTimes(2);
    expect(enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        recoveryKind: "attachment_unknown",
        providerCreationEpoch: epoch,
        dotyposReservationId: loserId,
      })
    );
    expect(persisted).toMatchObject({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
  });

  test("unblocks the retained winner only after exact losing-hold cancellation evidence", async () => {
    const epoch = "completed-orphan-recovery-epoch";
    const winnerId = "synthetic-retained-winner";
    const loserId = "synthetic-cancelled-loser";
    let persisted = makeReusableReservation({
      id: "completed-orphan-recovery-reservation",
      dotyposReservationId: winnerId,
      reservationState: "held",
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    const completeDifferentProviderAttachmentRecovery = mock(() =>
      Effect.sync(() => {
        persisted = makeReusableReservation({
          ...persisted,
          failureCode: `hold_creation_attached:${epoch}`,
        });
      })
    );
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.sync(() => persisted)),
      findById: mock(() => Effect.sync(() => persisted)),
      listReservations: mock(() =>
        Effect.succeed([
          makeProviderEvidence({
            id: winnerId,
            status: "NEW",
            note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
            customerId: persisted.dotyposCustomerId,
          }),
          makeProviderEvidence({
            id: loserId,
            status: "CANCELLED",
            note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
            customerId: persisted.dotyposCustomerId,
          }),
        ])
      ),
      completeDifferentProviderAttachmentRecovery,
    });

    expect(result.result.status).toBe("ready");
    expect(completeDifferentProviderAttachmentRecovery).toHaveBeenCalledWith({
      id: persisted.id,
      epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: persisted.reservationCreatedAt,
    });
    expect(persisted).toMatchObject({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_attached:${epoch}`,
    });
    expect(result.createReservation).not.toHaveBeenCalled();
  });

  test.each([
    ["missing winner", ["loser_cancelled"]],
    ["unsafe winner", ["winner_unsafe", "loser_cancelled"]],
    ["third live result", ["winner_live", "loser_cancelled", "third_live"]],
  ] as const)("keeps browser recovery fenced when post-compensation evidence has %s", async (_reason, evidenceKinds) => {
    const epoch = "synthetic-browser-fence-epoch";
    const winnerId = "synthetic-browser-fence-winner";
    const loserId = "synthetic-browser-fence-loser";
    const persisted = makeReusableReservation({
      id: "synthetic-browser-fence-reservation",
      dotyposReservationId: winnerId,
      reservationState: "held",
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    const completeDifferentProviderAttachmentRecovery = mock(() =>
      Effect.die("indefinite evidence must not remove the payment fence")
    );
    const createReservation = mock(() =>
      Effect.die("browser recovery must not create another provider hold")
    );
    const evidence = evidenceKinds.map((kind) =>
      makeProviderEvidence({
        id:
          kind === "third_live"
            ? "synthetic-browser-fence-third"
            : kind === "loser_cancelled"
              ? loserId
              : winnerId,
        status:
          kind === "winner_unsafe"
            ? "CONFIRMED"
            : kind === "loser_cancelled"
              ? "CANCELLED"
              : "NEW",
        note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
        customerId: persisted.dotyposCustomerId,
      })
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(persisted)),
        findById: mock(() => Effect.succeed(persisted)),
        listReservations: mock(() => Effect.succeed(evidence)),
        completeDifferentProviderAttachmentRecovery,
        createReservation,
      })
    ).rejects.toBeDefined();

    expect(completeDifferentProviderAttachmentRecovery).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
  });

  test("concurrent reconciliation attaches the same provider hold idempotently", async () => {
    const epoch = "concurrent-reconciliation-epoch";
    const providerId = "concurrent-reconciliation-provider-id";
    let persisted = makeReusableReservation({
      id: "concurrent-reconciliation-reservation",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    const attachHold = mock(
      (input: { readonly dotyposReservationId: string }) =>
        Effect.sync(() => {
          if (
            persisted.reservationState === "held" &&
            persisted.dotyposReservationId === input.dotyposReservationId
          ) {
            return;
          }
          persisted = makeReusableReservation({
            ...persisted,
            reservationState: "held",
            dotyposReservationId: input.dotyposReservationId,
            failureCode: `hold_creation_attached:${epoch}`,
          });
        })
    );
    const scenario = {
      findByAttemptKey: mock(() => Effect.sync(() => persisted)),
      findById: mock(() => Effect.sync(() => persisted)),
      listReservations: mock(() =>
        Effect.succeed([
          makeProviderEvidence({
            id: providerId,
            status: "NEW",
            note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
            customerId: persisted.dotyposCustomerId,
          }),
        ] as never)
      ),
      attachHold,
      createReservation: mock(() =>
        Effect.succeed({ id: "unused-provider-id" } as never)
      ),
    };

    const results = await Promise.all([
      runReusableReservationScenario(scenario),
      runReusableReservationScenario(scenario),
    ]);

    expect(results.every(({ result }) => result.status === "ready")).toBe(true);
    expect(persisted).toMatchObject({
      reservationState: "held",
      dotyposReservationId: providerId,
    });
    expect(scenario.createReservation).not.toHaveBeenCalled();
    expect(
      results.reduce(
        (count, result) => count + result.enqueueCleanup.mock.calls.length,
        0
      )
    ).toBeGreaterThanOrEqual(2);
  });

  test("does not retry provider creation after failed attachment handoff", async () => {
    const reservationId = "confirmed-compensation-release-retry";
    const firstProviderReservationId = "confirmed-cancelled-provider-hold";
    const epoch = "confirmed-compensation-epoch";
    let persistedReservation = makeReusableReservation({
      id: reservationId,
      dotyposReservationId: null,
      reservationState: "draft",
      failureCode: null,
    });
    let providerCreateAttempt = 0;

    const claimHoldCreation = mock(() =>
      Effect.sync(() => {
        if (persistedReservation.reservationState !== "draft") return null;
        persistedReservation = makeReusableReservation({
          ...persistedReservation,
          dotyposReservationId: null,
          reservationState: "creating_hold",
          failureCode: `hold_creation_pre_provider:${epoch}`,
        });
        return epoch;
      })
    );
    const beginProviderHoldCreation = mock(() =>
      Effect.sync(() => {
        if (
          persistedReservation.failureCode !==
          `hold_creation_pre_provider:${epoch}`
        ) {
          return false;
        }
        persistedReservation = makeReusableReservation({
          ...persistedReservation,
          failureCode: `hold_creation_provider_reconciliation:${epoch}`,
        });
        return true;
      })
    );
    const reclaimPreProviderHoldCreation = mock(() => Effect.succeed(false));
    const releaseHoldCreation = mock(() => Effect.void);
    const recordProviderHoldCandidate = mock((input) =>
      Effect.sync(() => {
        persistedReservation = makeReusableReservation({
          ...persistedReservation,
          dotyposReservationId: input.dotyposReservationId,
          reservationCreatedAt: input.reservationCreatedAt,
          failureCode: `hold_creation_candidate:${input.epoch}:${input.dotyposReservationId}:${input.reservationCreatedAt.epochMilliseconds}`,
        });
      })
    );
    const attachHold = mock(
      (attachment: {
        readonly dotyposReservationId: string;
        readonly reservationCreatedAt: Temporal.Instant;
      }) => {
        if (providerCreateAttempt === 1) {
          return Effect.fail(
            new Error("Synthetic first local attachment failure")
          );
        }
        return Effect.sync(() => {
          persistedReservation = makeReusableReservation({
            ...persistedReservation,
            dotyposReservationId: attachment.dotyposReservationId,
            reservationState: "held",
            reservationCreatedAt: attachment.reservationCreatedAt,
            failureCode: `hold_creation_attached:${epoch}`,
          });
        });
      }
    );
    const createReservation = mock(() => {
      providerCreateAttempt += 1;
      return Effect.succeed({
        id:
          providerCreateAttempt === 1
            ? firstProviderReservationId
            : "replacement-provider-hold",
      } as never);
    });
    const scenario = {
      findByAttemptKey: mock(() => Effect.sync(() => persistedReservation)),
      findById: mock(() => Effect.sync(() => persistedReservation)),
      claimHoldCreation,
      beginProviderHoldCreation,
      reclaimPreProviderHoldCreation,
      recordProviderHoldCandidate,
      releaseHoldCreation,
      attachHold,
      cancelReservation: mock(() => Effect.void),
      createReservation,
    };

    await expect(
      runReusableReservationScenario(scenario)
    ).rejects.toBeDefined();
    expect(persistedReservation).toMatchObject({
      reservationState: "creating_hold",
      dotyposReservationId: firstProviderReservationId,
      failureCode: expect.stringContaining(
        `hold_creation_candidate:${epoch}:${firstProviderReservationId}:`
      ),
    });
    expect(recordProviderHoldCandidate).toHaveBeenCalledTimes(2);
    expect(releaseHoldCreation).not.toHaveBeenCalled();
    expect(scenario.cancelReservation).not.toHaveBeenCalled();
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(attachHold).toHaveBeenCalledTimes(1);
  });

  test("never reattaches visibility-delayed provider evidence after compensation starts", async () => {
    const epoch = "visibility-delay-compensation-epoch";
    const providerId = "visibility-delay-provider-id";
    let persisted = makeReusableReservation({
      id: "visibility-delay-reservation-id",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_compensating:${epoch}`,
      updatedAt: Temporal.Instant.from("2000-01-01T00:00:00.000Z"),
    });
    const attachHold = mock(() => Effect.die("must not attach"));
    const releaseHoldCreation = mock(() => Effect.die("must not release"));
    const createReservation = mock(() => Effect.die("must not create"));
    const markAttachFailedCancellationRequired = mock((input) =>
      Effect.sync(() => {
        persisted = makeReusableReservation({
          ...persisted,
          dotyposReservationId: input.dotyposReservationId,
          reservationState: "cancellation_failed",
          reservationCreatedAt: input.reservationCreatedAt,
          failureCode: `attach_failed_cancel_failed:${input.epoch}`,
        });
      })
    );
    const enqueueCleanup = mock(() => Effect.void);

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.sync(() => persisted)),
        findById: mock(() => Effect.sync(() => persisted)),
        listReservations: mock(() =>
          Effect.succeed([
            makeProviderEvidence({
              id: providerId,
              status: "NEW",
              note: `Payment order: ${persisted.id}\nProvider creation epoch: ${epoch}`,
              customerId: persisted.dotyposCustomerId,
            }),
          ])
        ),
        attachHold,
        releaseHoldCreation,
        createReservation,
        markAttachFailedCancellationRequired,
        enqueueCleanup,
      })
    ).rejects.toMatchObject({ _tag: "PublicSafeActionError" });

    expect(persisted).toMatchObject({
      reservationState: "cancellation_failed",
      dotyposReservationId: providerId,
      failureCode: `attach_failed_cancel_failed:${epoch}`,
    });
    expect(attachHold).not.toHaveBeenCalled();
    expect(releaseHoldCreation).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
    expect(enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        recoveryKind: "unattached",
        providerCreationEpoch: epoch,
        dotyposReservationId: providerId,
      })
    );
  });

  test("revalidates a concurrent losing-hold marker before returning ready", async () => {
    const epoch = "ready-revalidation-epoch";
    const winnerId = "ready-revalidation-winner";
    const loserId = "ready-revalidation-loser";
    const initiallyAttached = makeReusableReservation({
      id: "ready-revalidation-reservation",
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_attached:${epoch}`,
    });
    const blocked = makeReusableReservation({
      ...initiallyAttached,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    const createReservation = mock(() => Effect.die("must not create"));

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(initiallyAttached)),
        findById: mock(() => Effect.succeed(blocked)),
        createReservation,
      })
    ).rejects.toMatchObject({ _tag: "PublicSafeActionError" });

    expect(createReservation).not.toHaveBeenCalled();
  });

  test("converges a real concurrent hold-creation CAS conflict on the persisted row", async () => {
    const { decideReservationPreparation } = await import(
      "./prepare-pay-state"
    );
    let persisted = makeReusableReservation({
      id: "concurrent-reservation-id",
      dotyposCustomerId: "persisted-concurrent-customer-id",
      dotyposReservationId: null,
      reservationState: "draft",
    });

    const repository = {
      claimHoldCreation: () =>
        Effect.sync(() => {
          if (persisted.reservationState !== "draft") return null;
          persisted = makeReusableReservation({
            ...persisted,
            dotyposReservationId: null,
            reservationState: "creating_hold",
            failureCode: "hold_creation_pre_provider:concurrent-epoch",
          });
          return "concurrent-epoch";
        }),
      findById: () => Effect.sync(() => persisted),
    } as unknown as WorkspaceReservationRepositoryType;

    const prepare = decideReservationPreparation({
      reservations: repository,
      checkoutSessionId: "session-id",
      reservation: persisted,
    }).pipe(
      Effect.tap((decision) =>
        decision._tag === "create_hold"
          ? Effect.sleep("10 millis").pipe(
              Effect.andThen(
                Effect.sync(() => {
                  persisted = makeReusableReservation({
                    ...persisted,
                    dotyposCustomerId: "persisted-concurrent-customer-id",
                    dotyposReservationId: "concurrent-dotypos-reservation-id",
                    reservationState: "held",
                  });
                })
              )
            )
          : Effect.void
      )
    );

    const decisions = await Effect.all([prepare, prepare], {
      concurrency: "unbounded",
    }).pipe(Effect.runPromise);

    expect(decisions.map((decision) => decision._tag).sort()).toEqual([
      "create_hold",
      "reuse_hold",
    ]);
    expect(
      decisions.find((decision) => decision._tag === "reuse_hold")?.reservation
        .dotyposCustomerId
    ).toBe("persisted-concurrent-customer-id");
    expect(
      decisions.every(
        (decision) => decision.reservation.id === "concurrent-reservation-id"
      )
    ).toBe(true);
  });

  test("uses the same reuse decision for an observed hold and a settled claim conflict", async () => {
    const { decideReservationPreparation } = await import(
      "./prepare-pay-state"
    );
    const held = makeReusableReservation({
      id: "definitive-held-reservation-id",
      dotyposCustomerId: "definitive-held-customer-id",
    });
    const draft = makeReusableReservation({
      ...held,
      dotyposReservationId: null,
      reservationState: "draft",
    });
    const directRepository = {
      claimHoldCreation: () => Effect.die("unused"),
      findById: () => Effect.die("unused"),
    } as unknown as WorkspaceReservationRepositoryType;
    const conflictRepository = {
      claimHoldCreation: () => Effect.succeed(null),
      findById: () => Effect.succeed(held),
    } as unknown as WorkspaceReservationRepositoryType;

    const [direct, conflict] = await Effect.all([
      decideReservationPreparation({
        reservations: directRepository,
        checkoutSessionId: "session-id",
        reservation: held,
      }),
      decideReservationPreparation({
        reservations: conflictRepository,
        checkoutSessionId: "session-id",
        reservation: draft,
      }),
    ]).pipe(Effect.runPromise);

    expect(direct).toMatchObject({
      _tag: "reuse_hold",
      reservation: {
        id: "definitive-held-reservation-id",
        dotyposCustomerId: "definitive-held-customer-id",
      },
    });
    expect(conflict).toEqual(direct);
  });

  test("queues attachment compensation without inline provider cancellation", async () => {
    const draft = makeReusableReservation({
      id: "attachment-compensation-reservation-id",
      dotyposReservationId: null,
      reservationState: "draft",
    });
    const marker = mock(() => Effect.void);
    const release = mock(() => Effect.void);
    const cancel = mock(() =>
      Effect.fail(new Error("Synthetic provider cancellation failure"))
    );
    const enqueueCleanup = mock(() => Effect.void);
    const createReservation = mock(() =>
      Effect.succeed({ id: "synthetic-provider-reservation-id" } as never)
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(null)),
        acquireDraft: mock(() =>
          Effect.succeed(
            ReservationDraftAcquisition.created({ reservation: draft })
          )
        ),
        attachHold: mock(() =>
          Effect.fail(
            new WorkspaceReservationStateError({
              operation: "attachHold",
              reservationId: draft.id,
              message: "Synthetic local attachment failure",
            })
          )
        ),
        releaseHoldCreation: release,
        markAttachFailedCancellationRequired: marker,
        cancelReservation: cancel,
        enqueueCleanup,
        createReservation,
      })
    ).rejects.toMatchObject({
      _tag: "PublicSafeActionError",
    });

    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(marker).not.toHaveBeenCalled();
    expect(enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        recoveryKind: "attachment_unknown",
        orderId: "attachment-compensation-reservation-id",
        dotyposReservationId: "synthetic-provider-reservation-id",
      })
    );
    expect(release).not.toHaveBeenCalled();
  });

  test("keeps a failed attachment candidate durable for queued compensation", async () => {
    const epoch = "synthetic-successful-compensation-epoch";
    const providerId = "synthetic-successful-compensation-provider";
    let persisted = makeReusableReservation({
      id: "synthetic-successful-compensation-order",
      dotyposReservationId: null,
      reservationCreatedAt: null,
      reservationState: "draft",
      failureCode: null,
    });
    const enqueueCleanup = mock(() => Effect.void);
    const recordProviderHoldCandidate = mock((input) =>
      Effect.suspend(() => {
        if (persisted.reservationState !== "creating_hold") {
          return Effect.fail(new Error("Synthetic candidate state cleared"));
        }
        persisted = makeReusableReservation({
          ...persisted,
          dotyposReservationId: input.dotyposReservationId,
          reservationCreatedAt: input.reservationCreatedAt,
          failureCode: `hold_creation_candidate:${input.epoch}:${input.dotyposReservationId}:${input.reservationCreatedAt.epochMilliseconds}`,
        });
        return Effect.void;
      })
    );
    const releaseHoldCreation = mock(() =>
      Effect.sync(() => {
        persisted = makeReusableReservation({
          ...persisted,
          dotyposReservationId: null,
          reservationCreatedAt: null,
          reservationState: "draft",
          failureCode: null,
        });
      })
    );
    const cancelReservation = mock(() => Effect.void);

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(null)),
        acquireDraft: mock(() =>
          Effect.succeed(
            ReservationDraftAcquisition.created({ reservation: persisted })
          )
        ),
        claimHoldCreation: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              reservationState: "creating_hold",
              failureCode: `hold_creation_pre_provider:${epoch}`,
            });
            return epoch;
          })
        ),
        beginProviderHoldCreation: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              failureCode: `hold_creation_provider_reconciliation:${epoch}`,
            });
            return true;
          })
        ),
        recordProviderHoldCandidate,
        attachHold: mock(() =>
          Effect.fail(new Error("Synthetic local attachment failure"))
        ),
        claimHoldCreationCompensation: mock(() =>
          Effect.sync(() => {
            persisted = makeReusableReservation({
              ...persisted,
              failureCode: `hold_creation_candidate_compensating:${epoch}:${providerId}:${persisted.reservationCreatedAt?.epochMilliseconds}`,
            });
            return true;
          })
        ),
        cancelReservation,
        releaseHoldCreation,
        enqueueCleanup,
        createReservation: mock(() =>
          Effect.succeed({ id: providerId } as never)
        ),
      })
    ).rejects.toBeDefined();

    const queuedInput = enqueueCleanup.mock.calls
      .map(([input]) => input)
      .find((input) => input.reason === "attachment_compensation");
    if (!queuedInput || queuedInput.reason !== "attachment_compensation") {
      throw new Error("Expected successful compensation queue handoff.");
    }
    expect(persisted).toMatchObject({
      reservationState: "creating_hold",
      dotyposReservationId: providerId,
      reservationCreatedAt: expect.any(Temporal.Instant),
      failureCode: expect.stringContaining(
        `hold_creation_candidate:${epoch}:${providerId}:`
      ),
    });
    expect(queuedInput).toEqual(
      expect.objectContaining({
        recoveryKind: "attachment_unknown",
        orderId: persisted.id,
        providerCreationEpoch: epoch,
        dotyposReservationId: providerId,
        reservationCreatedAt: persisted.reservationCreatedAt,
      })
    );
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(releaseHoldCreation).not.toHaveBeenCalled();
  });

  test("keeps PII and access-bearing rows out of preparation log annotations", async () => {
    const source = await Bun.file(
      new URL("./prepare-pay-state.ts", import.meta.url)
    ).text();

    expect(source).toContain("reservationKind: input.reservation.kind");
    expect(source).toContain("checkoutSessionKey");
    expect(source).toContain("checkoutAttemptKey");
    expect(source).not.toContain("Effect.annotateLogsScoped({ input");
    expect(source).not.toContain("Effect.annotateLogsScoped({ customer");
    expect(source).not.toContain(
      "Effect.annotateLogsScoped({ reservationDraft"
    );
    expect(source).not.toContain(
      "Effect.annotateLogsScoped({ claimConflictReservation"
    );
    expect(source).not.toContain("Effect.annotateLogsScoped({ checkoutDetails");
    expect(source).not.toContain(
      "Effect.annotateLogsScoped({ dotyposReservation"
    );
  });

  test("handles every ReservationPreparationDecision tag exhaustively", async () => {
    const source = await Bun.file(
      new URL("./prepare-pay-state.ts", import.meta.url)
    ).text();
    const decisionSection = source.slice(
      source.indexOf("export type ReservationPreparationDecision"),
      source.indexOf("const checkoutDetails")
    );

    expect(decisionSection).toContain("Data.TaggedEnum");
    expect(decisionSection).toContain(
      "ReservationPreparationDecision.create_hold"
    );
    expect(decisionSection).toContain(
      "ReservationPreparationDecision.reuse_hold"
    );
    expect(source).not.toContain('Match.discriminatorsExhaustive("_tag")');
    expect(decisionSection).toContain('Match.tag("create_hold"');
    expect(decisionSection).toContain('Match.tag("reuse_hold"');
    expect(decisionSection).toContain("Match.exhaustive");
  });

  test("re-queries the attempt after another request completes session supersession", async () => {
    const cancellingReservation = makeReusableReservation({
      reservationState: "cancelling",
    });
    const replacementReservation = makeReusableReservation({
      id: "replacement-reservation-id",
    });
    let attemptLookupCount = 0;
    let reservationLookupCount = 0;
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() =>
        Effect.succeed(
          attemptLookupCount++ === 2 ? replacementReservation : null
        )
      ),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(cancellingReservation)
      ),
      findById: mock(() =>
        Effect.succeed(
          reservationLookupCount++ === 0
            ? makeReusableReservation({ reservationState: "cancelled" })
            : replacementReservation
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(attemptLookupCount).toBe(3);
    expect(result.cancelReservation).not.toHaveBeenCalled();
    expect(result.acquireDraft).not.toHaveBeenCalled();
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
      renewCancellationClaim: mock(() => Effect.succeed(previousReservation)),
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
    expect(result.claimSupersessionCancellation).toHaveBeenCalledWith({
      id: "previous-reservation-id",
      ownerId: expect.any(String),
    });
    expect(result.completeSupersessionAndCreateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelledReservationId: "previous-reservation-id",
        cancellationOwnerId: expect.any(String),
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

  test.each([
    "hold_creation_candidate:synthetic-epoch:synthetic-provider:1780308000000",
    "hold_creation_candidate_compensating:synthetic-epoch:synthetic-provider:1780308000000",
    "hold_creation_orphan_recovery:synthetic-epoch:synthetic-loser",
    "hold_creation_orphan_processing:synthetic-epoch:synthetic-loser:synthetic-owner",
  ])("returns a bounded retryable outcome instead of looping on unresolved supersession recovery: %s", async (failureCode) => {
    const current = makeReusableReservation({
      id: "unresolved-supersession-reservation",
      failureCode,
    });
    const findCurrentByCheckoutSessionKey = mock(() => Effect.succeed(current));
    const claimSupersessionCancellation = mock(() =>
      Effect.die("unresolved recovery must not enter supersession")
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(null)),
        findCurrentByCheckoutSessionKey,
        claimSupersessionCancellation,
      })
    ).rejects.toBeDefined();

    expect(findCurrentByCheckoutSessionKey).toHaveBeenCalledTimes(1);
    expect(claimSupersessionCancellation).not.toHaveBeenCalled();
  });

  test("bounds repeated supersession claim loss without provider work", async () => {
    const current = makeReusableReservation({
      id: "synthetic-claim-loss-reservation",
    });
    const claimSupersessionCancellation = mock(() => Effect.succeed(null));
    const createReservation = mock(() =>
      Effect.die("claim loss must not create a provider reservation")
    );
    const cancelReservation = mock(() =>
      Effect.die("claim loss must not cancel without ownership")
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(null)),
        findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(current)),
        claimSupersessionCancellation,
        createReservation,
        cancelReservation,
      })
    ).rejects.toBeDefined();

    expect(claimSupersessionCancellation.mock.calls.length).toBeGreaterThan(1);
    expect(claimSupersessionCancellation.mock.calls.length).toBeLessThan(10);
    expect(createReservation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  test("bounds repeated session-occupied acquisition conflicts", async () => {
    const occupied = makeReusableReservation({
      id: "synthetic-session-occupied-reservation",
    });
    const acquireDraft = mock(() =>
      Effect.succeed(
        ReservationDraftAcquisition.session_occupied({
          reservation: occupied,
        })
      )
    );
    const createReservation = mock(() =>
      Effect.die("session conflict must not create a provider reservation")
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(null)),
        findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(null)),
        acquireDraft,
        createReservation,
      })
    ).rejects.toBeDefined();

    expect(acquireDraft.mock.calls.length).toBeGreaterThan(1);
    expect(acquireDraft.mock.calls.length).toBeLessThan(10);
    expect(createReservation).not.toHaveBeenCalled();
  });

  test("maps exhausted repository acquisition conflicts to retryable unavailability", async () => {
    const acquireDraft = mock(() =>
      Effect.succeed(ReservationDraftAcquisition.conflict_unresolved({}))
    );
    const createReservation = mock(() =>
      Effect.die(
        "unresolved acquisition must not create a provider reservation"
      )
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(null)),
        findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(null)),
        acquireDraft,
        createReservation,
      })
    ).rejects.toBeDefined();

    expect(acquireDraft).toHaveBeenCalledTimes(1);
    expect(createReservation).not.toHaveBeenCalled();
  });

  test.each([
    ["draft", null],
    ["draft", "hold_creation_pre_provider_retired"],
    ["creating_hold", "hold_creation_pre_provider:synthetic-prior-epoch"],
  ] as const)("isolates a message-changed attempt from a durable prior %s row", async (reservationState, failureCode) => {
    const { deriveCheckoutAttemptKey, deriveCheckoutSessionKey } = await import(
      "@/features/checkout/backend/checkout/checkout-session-key.server"
    );
    const priorAttemptKey = deriveCheckoutAttemptKey({
      checkoutSessionId: "session-id",
      checkoutAttemptId: "synthetic-prior-attempt-id",
      reservation: {
        ...reservation,
        message: "Synthetic prior message",
      },
    });
    const prior = makeReusableReservation({
      id: `synthetic-prior-${reservationState}`,
      checkoutAttemptKey: priorAttemptKey,
      dotyposReservationId: null,
      reservationState,
      failureCode,
    });
    let currentLookup = 0;
    const acquireDraft = mock((input) =>
      Effect.succeed(
        ReservationDraftAcquisition.created({
          reservation: makeReusableReservation({
            id: `synthetic-changed-${reservationState}`,
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            dotyposReservationId: null,
            reservationState: "draft",
          }),
        })
      )
    );
    const retirePreProviderDraft = mock(() => Effect.succeed(true));
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(currentLookup++ === 0 ? prior : null)
      ),
      acquireDraft,
      retirePreProviderDraft,
    });

    expect(result.result.status).toBe("ready");
    expect(retirePreProviderDraft).toHaveBeenCalledWith({
      id: prior.id,
      checkoutAttemptKey: prior.checkoutAttemptKey,
    });
    expect(acquireDraft).toHaveBeenCalledTimes(1);
    expect(acquireDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutSessionKey: deriveCheckoutSessionKey("attempt-id"),
      })
    );
    expect(result.cancelReservation).not.toHaveBeenCalled();
    expect(result.createReservation).toHaveBeenCalledTimes(1);
  });

  test("bounds a changed attempt when pre-provider retirement repeatedly loses its CAS", async () => {
    const prior = makeReusableReservation({
      id: "synthetic-prior-retirement-conflict",
      checkoutAttemptKey: "synthetic-prior-retirement-attempt",
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode:
        "hold_creation_pre_provider:synthetic-prior-retirement-epoch",
    });
    const retirePreProviderDraft = mock(() => Effect.succeed(false));
    const createReservation = mock(() =>
      Effect.die("a lost retirement CAS must not create a provider hold")
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(null)),
        findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(prior)),
        retirePreProviderDraft,
        createReservation,
      })
    ).rejects.toBeDefined();

    expect(retirePreProviderDraft).toHaveBeenCalledTimes(3);
    expect(createReservation).not.toHaveBeenCalled();
  });

  test("does not mutate exact-retry details when payment or recovery wins the definitive reread", async () => {
    const reusable = makeReusableReservation();
    const raced = makeReusableReservation({
      ...reusable,
      paymentState: "pending",
      activePaymentAttemptId: "synthetic-pending-attempt",
      failureCode:
        "hold_creation_orphan_recovery:synthetic-epoch:synthetic-loser",
    });
    const updateReservationDetails = mock(() =>
      Effect.die("reuse must not mutate before definitive eligibility")
    );

    await expect(
      runReusableReservationScenario({
        findByAttemptKey: mock(() => Effect.succeed(reusable)),
        findById: mock(() => Effect.succeed(raced)),
        updateReservationDetails,
      })
    ).rejects.toBeDefined();

    expect(updateReservationDetails).not.toHaveBeenCalled();
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
      acquireDraft: mock((input) =>
        Effect.succeed(
          ReservationDraftAcquisition.created({
            reservation: makeReusableReservation({
              id: "rotated-reservation-id",
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
              dotyposReservationId: null,
              reservationState: "draft",
            }),
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

  test("rediscovers an exact rotated attempt after the prior session changes", async () => {
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/checkout"
    );
    const rotated = makeReusableReservation({
      id: "exact-rotated-retry-reservation",
    });
    let attemptLookup = 0;
    const findCurrentByCheckoutSessionKey = mock(() =>
      Effect.die("must not depend on the prior session state")
    );
    const acquireDraft = mock(() => Effect.die("must not acquire"));
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() =>
        Effect.succeed(attemptLookup++ === 0 ? null : rotated)
      ),
      findCurrentByCheckoutSessionKey,
      acquireDraft,
    });

    expect(result.result.status).toBe("ready");
    expect(findCurrentByCheckoutSessionKey).not.toHaveBeenCalled();
    expect(acquireDraft).not.toHaveBeenCalled();
    expect(result.createReservation).not.toHaveBeenCalled();
    if (result.result.status !== "ready") throw new Error("Expected ready");
    const token = new URL(
      result.result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(Effect.runSync(openPayState(token ?? "")).checkoutSessionId).toBe(
      "attempt-id"
    );
  });

  test("never rotates or creates for an exact terminal attempt", async () => {
    for (const terminal of [
      { reservationState: "held", paymentState: "pending" },
      { reservationState: "confirmed", paymentState: "paid" },
      { reservationState: "cancelled", paymentState: "cancelled" },
      { reservationState: "held", paymentState: "cancelled" },
    ] as const) {
      const exact = makeReusableReservation(terminal);
      const findCurrentByCheckoutSessionKey = mock(() =>
        Effect.die("must not inspect a different session row")
      );
      const acquireDraft = mock(() => Effect.die("must not acquire"));
      const claimHoldCreation = mock(() => Effect.die("must not claim"));
      const beginProviderHoldCreation = mock(() =>
        Effect.die("must not enter provider boundary")
      );
      const createReservation = mock(() => Effect.die("must not create"));

      await expect(
        runReusableReservationScenario({
          findByAttemptKey: mock(() => Effect.succeed(exact)),
          findCurrentByCheckoutSessionKey,
          acquireDraft,
          claimHoldCreation,
          beginProviderHoldCreation,
          createReservation,
        })
      ).rejects.toMatchObject({ _tag: "PublicSafeActionError" });

      expect(findCurrentByCheckoutSessionKey).not.toHaveBeenCalled();
      expect(acquireDraft).not.toHaveBeenCalled();
      expect(claimHoldCreation).not.toHaveBeenCalled();
      expect(beginProviderHoldCreation).not.toHaveBeenCalled();
      expect(createReservation).not.toHaveBeenCalled();
    }
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
      findByAttemptKey: mock(() => Effect.succeed(null)),
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
      renewCancellationClaim: mock(() =>
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
      acquireDraft: mock((input) =>
        Effect.succeed(
          ReservationDraftAcquisition.created({
            reservation: makeReusableReservation({
              id: "rotated-reservation-id",
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
              dotyposReservationId: null,
              reservationState: "draft",
            }),
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(markCancellationFailed).toHaveBeenCalledWith({
      id: previousReservation.id,
      ownerId: expect.any(String),
      disposition: "retryable",
      recoveryReason: "supersession_recovery",
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
      findByAttemptKey: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() =>
        Effect.succeed(currentLookupCount++ === 0 ? previousReservation : null)
      ),
      claimSupersessionCancellation: mock(() =>
        Effect.succeed(previousReservation)
      ),
      getReservationStatus: mock(() => Effect.succeed("CONFIRMED" as const)),
      acquireDraft: mock((input) =>
        Effect.succeed(
          ReservationDraftAcquisition.created({
            reservation: makeReusableReservation({
              id: "rotated-reservation-id",
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
              dotyposReservationId: null,
              reservationState: "draft",
            }),
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.cancelReservation).not.toHaveBeenCalled();
    expect(result.markCancellationFailed).toHaveBeenCalledWith({
      id: previousReservation.id,
      ownerId: expect.any(String),
      disposition: "manual_review",
      recoveryReason: "supersession_recovery",
      failureCode: "checkout_supersession_cancel_failed",
    });
  });

  test("does not delete a superseded provider reservation after losing cancellation ownership", async () => {
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
      renewCancellationClaim: mock(() => Effect.succeed(null)),
      acquireDraft: mock((input) =>
        Effect.succeed(
          ReservationDraftAcquisition.created({
            reservation: makeReusableReservation({
              id: "rotated-reservation-id",
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
              dotyposReservationId: null,
              reservationState: "draft",
            }),
          })
        )
      ),
    });

    expect(result.result.status).toBe("ready");
    expect(result.getReservationStatus).toHaveBeenCalledTimes(1);
    expect(result.cancelReservation).not.toHaveBeenCalled();
    expect(result.markCancellationFailed).toHaveBeenCalledWith({
      id: previousReservation.id,
      ownerId: expect.any(String),
      disposition: "retryable",
      recoveryReason: "supersession_recovery",
      failureCode: "checkout_supersession_cancel_failed",
    });
  });

  test("attachment failures enqueue compensation without an unowned inline provider delete", async () => {
    const source = await Bun.file(
      new URL("./prepare-pay-state.ts", import.meta.url)
    ).text();
    const start = source.indexOf(
      "Workspace reservation hold attach failed; scheduling owned cancellation compensation"
    );
    const end = source.indexOf(
      'yield* Effect.logInfo("Workspace reservation hold attached")',
      start
    );
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const compensation = source.slice(start, end);

    expect(compensation).toContain("enqueueAttachmentCancellationCompensation");
    expect(compensation).toContain("dotyposReservationId");
    expect(compensation).not.toContain("dotypos.cancelReservation");
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
