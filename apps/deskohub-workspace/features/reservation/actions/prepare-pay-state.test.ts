import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import type { LegalEvidenceEventRepository as LegalEvidenceEventRepositoryType } from "@/features/checkout/backend/repositories";
import type {
  WorkspaceCheckoutAccessCodeService as WorkspaceCheckoutAccessCodeServiceType,
  WorkspaceTableAssignmentService as WorkspaceTableAssignmentServiceType,
} from "@/features/checkout/backend/reservation";
import type { IWorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";

mock.module("server-only", () => ({}));

mock.module("@/features/legal/acceptance-snapshot", () => ({
  getLegalAcceptanceSnapshot: mock(() =>
    Promise.resolve({
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
  entryTier: "basic" as const,
  date: "2026-07-01",
  coffee: false,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
};

const reusableHoldExpiresAt = new Date("2030-07-01T12:00:00.000Z");

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
    locale: "en-US",
    reservationHoldExpiresAt: reusableHoldExpiresAt,
    reservationHoldExpiredAt: null,
    reservationCreatedAt: new Date("2026-07-01T09:55:00.000Z"),
    reservationConfirmedAt: null,
    reservationCancelledAt: null,
    paidAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    failureCode: null,
    fulfillmentFailureCode: null,
    createdAt: new Date("2026-07-01T09:55:00.000Z"),
    updatedAt: new Date("2026-07-01T09:55:00.000Z"),
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
  const updateProductIntent = mock(() => Effect.void);
  const recordMany = mock((events) => Effect.succeed(events as never));
  const ensureAvailable = mock(() => Effect.void);
  const verifyHuman = mock(() => Effect.void);
  const createDraft = input.createDraft ?? mock(() => Effect.die("unused"));
  const claimHoldCreation =
    input.claimHoldCreation ?? mock(() => Effect.die("unused"));
  const findById = input.findById ?? mock(() => Effect.die("unused"));

  const result = await prepareWorkspacePayState({
    locale: "en-US",
    reservationIntentId: "intent-id",
    reservation,
    legalConsent: true,
  }).pipe(
    Effect.provide(BotProtectionServiceMock({ verifyHuman })),
    Effect.provide(
      Layer.succeed(WorkspaceAvailabilityService, {
        getAvailability: mock(() => Effect.die("unused")),
        ensureAvailable,
      } satisfies IWorkspaceAvailabilityService)
    ),
    Effect.provide(
      Layer.succeed(WorkspaceReservationRepository, {
        findByIntentKey: input.findByIntentKey,
        createDraft,
        claimHoldCreation,
        findById,
        releaseHoldCreation: mock(() => Effect.void),
        updateProductIntent,
        attachHold: mock(() => Effect.die("unused")),
        markAttachFailedCancellationRequired: mock(() => Effect.void),
      } as unknown as WorkspaceReservationRepositoryType)
    ),
    Effect.provide(
      Layer.succeed(WorkspaceCheckoutAccessCodeService, {
        generateCustomerAccessCode: mock(() => Effect.succeed("ACCESS-123")),
      } satisfies WorkspaceCheckoutAccessCodeServiceType)
    ),
    Effect.provide(
      Layer.succeed(LegalEvidenceEventRepository, {
        record: mock(() => Effect.die("unused")),
        recordMany,
      } as unknown as LegalEvidenceEventRepositoryType)
    ),
    Effect.provide(
      Layer.succeed(ReservationHoldCleanupScheduleService, {
        enqueueCleanup,
      } as never)
    ),
    Effect.provide(
      Layer.succeed(DotyposService, {
        findCustomer: mock(() => Effect.succeed({ _tag: "NotFound" })),
        getCustomerDiscount: mock(() => Effect.succeed(undefined)),
        findOrCreateCustomer: mock(() => Effect.succeed({ id: "customer-id" })),
      } as unknown as typeof DotyposService.Service)
    ),
    Effect.runPromise
  );

  return {
    result,
    enqueueCleanup,
    updateProductIntent,
    recordMany,
    ensureAvailable,
    createDraft,
    claimHoldCreation,
    findById,
    verifyHuman,
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
    const { WorkspaceTableAssignmentService } = await import(
      "@/features/checkout/backend/reservation"
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
        productTier: input.productTier,
        productCoffee: input.productCoffee,
        productMonitorOption: input.productMonitorOption,
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
    const result = await prepareWorkspacePayState({
      locale: "en-US",
      reservationIntentId: "intent-id",
      reservation,
      legalConsent: true,
    }).pipe(
      Effect.provide(BotProtectionServiceMock({ verifyHuman })),
      Effect.provide(
        Layer.succeed(WorkspaceAvailabilityService, {
          getAvailability: mock(() => Effect.die("unused")),
          ensureAvailable,
        } satisfies IWorkspaceAvailabilityService)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, {
          findByIntentKey: mock(() => Effect.succeed(null)),
          createDraft,
          claimHoldCreation,
          attachHold,
          findById: mock(() => Effect.succeed(null)),
          releaseHoldCreation: mock(() => Effect.void),
          updateProductIntent: mock(() => Effect.die("unused")),
          markAttachFailedCancellationRequired: mock(() => Effect.void),
        } as unknown as WorkspaceReservationRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceCheckoutAccessCodeService, {
          generateCustomerAccessCode: mock(() => Effect.succeed("ACCESS-123")),
        } satisfies WorkspaceCheckoutAccessCodeServiceType)
      ),
      Effect.provide(
        Layer.succeed(LegalEvidenceEventRepository, {
          record: mock(() => Effect.die("unused")),
          recordMany,
        } as unknown as LegalEvidenceEventRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceTableAssignmentService, {
          assignTableId,
        } satisfies WorkspaceTableAssignmentServiceType)
      ),
      Effect.provide(
        Layer.succeed(ReservationHoldCleanupScheduleService, {
          enqueueCleanup,
        } as never)
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          findCustomer: mock(() => Effect.succeed({ _tag: "NotFound" })),
          getCustomerDiscount: mock(() => Effect.succeed(undefined)),
          findOrCreateCustomer: mock(() =>
            Effect.succeed({ id: "customer-id" })
          ),
          createReservation,
        } as unknown as typeof DotyposService.Service)
      ),
      Effect.provide(
        Layer.succeed(PostHogEventService, { capture: mock(() => Effect.void) })
      ),
      Effect.runPromise
    );

    expect(ensureAvailable).toHaveBeenCalledWith({
      _tag: "cowork",
      date: reservation.date,
      entryTier: reservation.entryTier,
      monitorOption: undefined,
    });
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(claimHoldCreation).toHaveBeenCalledWith("reservation-id");
    expect(assignTableId).toHaveBeenCalledWith({
      tier: "basic",
      date: reservation.date,
      coffee: false,
      monitorOption: undefined,
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
      reservationHoldExpiresAt: expect.any(Date),
    });
    expect(eventOrder).toEqual([
      "bot-verification",
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
    const token = new URL(
      result.redirectUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(token).toBeTruthy();
    expect(openPayState(token ?? "").orderId).toBe("reservation-id");
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
    expect(result.updateProductIntent).toHaveBeenCalledWith({
      id: existingReservation.id,
      productTier: "basic",
      productCoffee: false,
      productMonitorOption: undefined,
      locale: "en-US",
    });
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
