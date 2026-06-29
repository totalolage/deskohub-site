import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import type { WorkspaceCheckoutAccessCodeService as WorkspaceCheckoutAccessCodeServiceType } from "@/features/checkout/backend/access-code.service";
import type { LegalEvidenceEventRepository as LegalEvidenceEventRepositoryType } from "@/features/checkout/backend/legal-evidence-event.repository";
import type { OperationalEventRepository as OperationalEventRepositoryType } from "@/features/checkout/backend/operational-event.repository";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import type { WorkspaceTableAssignmentService as WorkspaceTableAssignmentServiceType } from "@/features/checkout/backend/workspace-table-assignment.service";
import type { WorkspaceAvailabilityService as WorkspaceAvailabilityServiceType } from "@/features/reservation/backend/workspace-availability.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";

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
  const { prepareWorkspacePayStateEffect } = await import(
    "./prepare-pay-state"
  );
  const { WorkspaceCheckoutAccessCodeService } = await import(
    "@/features/checkout/backend/access-code.service"
  );
  const { LegalEvidenceEventRepository } = await import(
    "@/features/checkout/backend/legal-evidence-event.repository"
  );
  const { ReservationHoldCleanupService } = await import(
    "@/features/checkout/backend/reservation-hold-cleanup.service"
  );
  const { ReservationHoldCleanupScheduleService } = await import(
    "@/features/checkout/backend/reservation-hold-cleanup-queue.service"
  );
  const { WorkspaceAvailabilityService } = await import(
    "@/features/reservation/backend/workspace-availability.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );

  const enqueueCleanup = mock(() => Effect.void);
  const updateProductIntent = mock(() => Effect.void);
  const recordMany = mock((events) => Effect.succeed(events as never));
  const ensureAvailable = mock(() => Effect.void);
  const createDraft = input.createDraft ?? mock(() => Effect.die("unused"));
  const claimHoldCreation =
    input.claimHoldCreation ?? mock(() => Effect.die("unused"));
  const findById = input.findById ?? mock(() => Effect.die("unused"));

  const result = await prepareWorkspacePayStateEffect({
    locale: "en-US",
    reservationIntentId: "intent-id",
    reservation,
    legalConsent: true,
  }).pipe(
    Effect.provide(
      Layer.succeed(WorkspaceAvailabilityService, {
        getAvailability: mock(() => Effect.die("unused")),
        ensureAvailable,
      } satisfies WorkspaceAvailabilityServiceType)
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
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("unused")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType)
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
  };
};

describe("prepareWorkspacePayStateEffect", () => {
  test("creates a held reservation and returns an openable pay state", async () => {
    const { prepareWorkspacePayStateEffect } = await import(
      "./prepare-pay-state"
    );
    const { openPayState, payStateTokenQueryParam } = await import(
      "@/features/checkout/backend/pay-state"
    );
    const { WorkspaceCheckoutAccessCodeService } = await import(
      "@/features/checkout/backend/access-code.service"
    );
    const { LegalEvidenceEventRepository } = await import(
      "@/features/checkout/backend/legal-evidence-event.repository"
    );
    const { OperationalEventRepository } = await import(
      "@/features/checkout/backend/operational-event.repository"
    );
    const { ReservationHoldCleanupService } = await import(
      "@/features/checkout/backend/reservation-hold-cleanup.service"
    );
    const { ReservationHoldCleanupScheduleService } = await import(
      "@/features/checkout/backend/reservation-hold-cleanup-queue.service"
    );
    const { WorkspaceTableAssignmentService } = await import(
      "@/features/checkout/backend/workspace-table-assignment.service"
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

    const eventOrder: string[] = [];
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
    const sweepExpiredHolds = mock(() =>
      Effect.sync(() => {
        eventOrder.push("sweep");
        return { cancelled: 0, skipped: 0, failed: 0 };
      })
    );

    const result = await prepareWorkspacePayStateEffect({
      locale: "en-US",
      reservationIntentId: "intent-id",
      reservation,
      legalConsent: true,
    }).pipe(
      Effect.provide(
        Layer.succeed(WorkspaceAvailabilityService, {
          getAvailability: mock(() => Effect.die("unused")),
          ensureAvailable,
        } satisfies WorkspaceAvailabilityServiceType)
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
        Layer.succeed(ReservationHoldCleanupService, {
          cancelOrderHold: mock(() => Effect.succeed("cancelled" as const)),
          sweepExpiredHolds,
        } satisfies ReservationHoldCleanupServiceType)
      ),
      Effect.provide(
        Layer.succeed(ReservationHoldCleanupScheduleService, {
          enqueueCleanup,
        } as never)
      ),
      Effect.provide(
        Layer.succeed(OperationalEventRepository, {
          record: mock(() => Effect.die("unused")),
        } as unknown as OperationalEventRepositoryType)
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
    expect(sweepExpiredHolds).toHaveBeenCalledWith({
      now: expect.any(Date),
      limit: 10,
    });
    expect(eventOrder).toEqual(["sweep", "availability", "attach", "enqueue"]);
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

  test("enqueues cleanup when reusing an existing held reservation", async () => {
    const existingReservation = makeReusableReservation();
    const result = await runReusableReservationScenario({
      findByIntentKey: mock(() => Effect.succeed(existingReservation)),
    });

    expect(result.result.status).toBe("ready");
    expect(result.ensureAvailable).not.toHaveBeenCalled();
    expect(result.enqueueCleanup).toHaveBeenCalledWith({
      orderId: existingReservation.id,
      reservationHoldExpiresAt: reusableHoldExpiresAt,
    });
    expect(result.updateProductIntent).toHaveBeenCalledWith({
      id: existingReservation.id,
      productTier: "basic",
      productCoffee: false,
      productMonitorOption: undefined,
      locale: "en-US",
    });
  });

  test("enqueues cleanup when reusing a concurrently created held reservation", async () => {
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
    expect(result.enqueueCleanup).toHaveBeenCalledWith({
      orderId: claimConflictReservation.id,
      reservationHoldExpiresAt: reusableHoldExpiresAt,
    });
  });
});
