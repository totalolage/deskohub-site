import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { LegalEvidenceEventRepository as LegalEvidenceEventRepositoryType } from "@/features/checkout/backend/repositories";
import type { WorkspaceCheckoutAccessCodeService as WorkspaceCheckoutAccessCodeServiceType } from "@/features/checkout/backend/reservation";
import { WorkspaceTableAssignmentServiceMock } from "@/features/checkout/backend/reservation/workspace-table-assignment.service.mock";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import type { IWorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import type {
  WorkspaceReservation,
  WorkspaceReservationRepository as WorkspaceReservationRepositoryType,
} from "@/features/reservation/backend/workspace-reservation.repository";

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

const makeReusableReservation = (
  overrides: Partial<WorkspaceReservation> = {}
): WorkspaceReservation =>
  ({
    id: "existing-reservation-id",
    reservationIntentKey: "intent-key",
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
  readonly findByIntentKey: ReturnType<typeof mock>;
  readonly createDraft?: ReturnType<typeof mock>;
  readonly claimHoldCreation?: ReturnType<typeof mock>;
  readonly findById?: ReturnType<typeof mock>;
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
    input.claimHoldCreation ?? mock(() => Effect.die("unused"));
  const findById = input.findById ?? mock(() => Effect.die("unused"));
  const quote = mock(({ discountableSubtotal, product }) =>
    Effect.succeed({
      product,
      discountableSubtotal,
      discounts: [],
      totalDiscount: { ...discountableSubtotal, value: 0 },
      discountedSubtotal: discountableSubtotal,
    })
  );
  const findOrCreateCustomer = mock(() =>
    Effect.succeed({ id: "customer-id" })
  );
  const testLayer = Layer.mergeAll(
    DiscountServiceMock({ quote }),
    BotProtectionServiceMock({ verifyHuman }),
    Layer.succeed(WorkspaceAvailabilityService, {
      getAvailability: mock(() => Effect.die("unused")),
      ensureAvailable,
    } satisfies IWorkspaceAvailabilityService),
    Layer.succeed(WorkspaceReservationRepository, {
      findByIntentKey: input.findByIntentKey,
      createDraft,
      claimHoldCreation,
      findById,
      releaseHoldCreation: mock(() => Effect.void),
      updateReservationDetails,
      attachHold: mock(() => Effect.die("unused")),
      markAttachFailedCancellationRequired: mock(() => Effect.void),
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
      assignTableId: mock(() => Effect.die("unused")),
    }),
    Layer.succeed(PostHogEventService, {
      capture: mock(() => Effect.void),
    }),
    Layer.succeed(DotyposService, {
      findOrCreateCustomer,
    } as unknown as typeof DotyposService.Service)
  );

  const result = await prepareWorkspacePayState({
    locale: "en-US",
    reservationIntentId: "intent-id",
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
    verifyHuman,
    quote,
    findOrCreateCustomer,
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
    const createDraft = mock((input) =>
      Effect.succeed({
        id: "reservation-id",
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
    const quote = mock(({ discountableSubtotal, product }) =>
      Effect.sync(() => {
        eventOrder.push("quote");
        return {
          product,
          discountableSubtotal,
          discounts: [],
          totalDiscount: { ...discountableSubtotal, value: 0 },
          discountedSubtotal: discountableSubtotal,
        };
      })
    );
    const testLayer = Layer.mergeAll(
      DiscountServiceMock({ quote }),
      BotProtectionServiceMock({ verifyHuman }),
      Layer.succeed(WorkspaceAvailabilityService, {
        getAvailability: mock(() => Effect.die("unused")),
        ensureAvailable,
      } satisfies IWorkspaceAvailabilityService),
      Layer.succeed(WorkspaceReservationRepository, {
        findByIntentKey: mock(() => Effect.succeed(null)),
        createDraft,
        claimHoldCreation,
        attachHold,
        findById: mock(() => Effect.succeed(null)),
        releaseHoldCreation: mock(() => Effect.void),
        updateReservationDetails: mock(() => Effect.die("unused")),
        markAttachFailedCancellationRequired: mock(() => Effect.void),
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
      reservationIntentId: "intent-id",
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
      "availability",
      "customer",
      "quote",
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
    const token = new URL(
      result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(token).toBeTruthy();
    const state = Effect.runSync(openPayState(token ?? ""));
    expect(state.orderId).toBe("reservation-id");
    expect(state.submittedCode).toBeUndefined();
    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: "customer-id",
      })
    );
    expect(quote.mock.calls[0]?.[0]).toHaveProperty("submittedCode", undefined);
  });

  test("reuses an existing held reservation without scheduling cleanup", async () => {
    const existingReservation = makeReusableReservation();
    const result = await runReusableReservationScenario({
      findByIntentKey: mock(() => Effect.succeed(existingReservation)),
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
    expect(result.findOrCreateCustomer).not.toHaveBeenCalled();
    expect(result.quote).toHaveBeenCalledWith(
      expect.objectContaining({
        dotyposCustomerId: existingReservation.dotyposCustomerId,
      })
    );
    expect(result.quote.mock.calls[0]?.[0]).toHaveProperty(
      "submittedCode",
      undefined
    );
  });

  test("reuses a concurrently created held reservation without scheduling cleanup", async () => {
    const claimConflictReservation = makeReusableReservation({
      id: "claim-conflict-reservation-id",
    });
    const result = await runReusableReservationScenario({
      findByIntentKey: mock(() => Effect.succeed(null)),
      createDraft: mock(() => Effect.succeed({ id: "draft-id" } as never)),
      claimHoldCreation: mock(() => Effect.succeed(false)),
      findById: mock(() => Effect.succeed(claimConflictReservation)),
    });

    expect(result.result.status).toBe("ready");
    expect(result.claimHoldCreation).toHaveBeenCalledWith("draft-id");
    expect(result.findById).toHaveBeenCalledWith("draft-id");
    expect(result.enqueueCleanup).not.toHaveBeenCalled();
    expect(result.quote).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dotyposCustomerId: claimConflictReservation.dotyposCustomerId,
      })
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
      reservationIntentId: "intent-id",
      reservation,
      legalConsent: true,
    }).pipe(
      Effect.provide(BotProtectionServiceMock({ verifyHuman }))
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
