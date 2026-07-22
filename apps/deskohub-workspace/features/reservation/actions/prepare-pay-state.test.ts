import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
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
import {
  type AffirmedDiscountAdvertisementQuote,
  affirmedDiscountAdvertisementQuoteCodec,
  type DiscountAdvertisementQuote,
  discountAdvertisementQuoteCodec,
} from "@/features/discounts";
import { discountIdSchema } from "@/features/discounts/contracts";
import type { IWorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";

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
    paidAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    failureCode: null,
    fulfillmentFailureCode: null,
    createdAt: Temporal.Instant.from("2026-07-01T09:55:00.000Z"),
    updatedAt: Temporal.Instant.from("2026-07-01T09:55:00.000Z"),
    ...overrides,
  }) as WorkspaceReservation;

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
      findByAttemptKey: input.findByAttemptKey,
      findCurrentByCheckoutSessionKey:
        input.findCurrentByCheckoutSessionKey ??
        mock(() => Effect.succeed(null)),
      createDraft,
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
      createReservation,
    } as unknown as typeof DotyposService.Service)
  );

  const result = await prepareWorkspacePayState({
    locale: "en-US",
    checkoutSessionId: "session-id",
    checkoutAttemptId: "attempt-id",
    advertisedPriceToken:
      input.advertisedPriceToken ?? (await buildAdvertisedPriceToken()),
    reservation,
    legalConsent: true,
  }).pipe(Effect.provide(testLayer), Effect.runPromise);

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
      reservationState: "draft",
      reservationDetails: input.reservationDetails,
    } as never)
  );
  const assignTableId = mock(() => Effect.succeed("meeting-room-table-id"));
  const createReservation = mock(() =>
    Effect.succeed({ id: "dotypos-meeting-room-id" } as never)
  );
  const attachHold = mock(() => Effect.void);
  const enqueueCleanup = mock(() => Effect.void);
  const discountQuote = mock(({ discountableSubtotal, product }) =>
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
      Layer.provide(DiscountServiceMock({ quote: discountQuote }))
    ),
    BotProtectionServiceMock({ verifyHuman: mock(() => Effect.void) }),
    Layer.succeed(WorkspaceAvailabilityService, {
      getAvailability: mock(() => Effect.die("unused")),
      ensureAvailable,
    } satisfies IWorkspaceAvailabilityService),
    Layer.succeed(WorkspaceReservationRepository, {
      findByAttemptKey: mock(() => Effect.succeed(null)),
      findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(null)),
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
    discountQuote,
  };
};

describe("prepareWorkspacePayState", () => {
  test("accepts meeting-room preparation without a cowork advertisement", async () => {
    const { preparePayStateSchema } = await import(
      "./prepare-pay-state.schema"
    );
    const result = await preparePayStateSchema["~standard"].validate({
      locale: "en-US",
      checkoutSessionId: "meeting-room-session-id",
      checkoutAttemptId: "meeting-room-attempt-id",
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
    expect(scenario.discountQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        product: { kind: "meeting-room", durationMinutes: 240 },
        reservationDate: "2099-06-10",
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
        findByAttemptKey: mock(() => Effect.succeed(null)),
        findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(null)),
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

  test("reuses an immediate retry without scheduling cleanup", async () => {
    const existingReservation = makeReusableReservation();
    const result = await runReusableReservationScenario({
      findByAttemptKey: mock(() => Effect.succeed(existingReservation)),
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
        entryTier: "basic",
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
      findByAttemptKey: mock(() =>
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
