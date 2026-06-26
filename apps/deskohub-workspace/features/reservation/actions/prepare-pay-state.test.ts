import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { WorkspaceCheckoutAccessCodeService as WorkspaceCheckoutAccessCodeServiceType } from "@/features/checkout/backend/access-code.service";
import type { LegalEvidenceEventRepository as LegalEvidenceEventRepositoryType } from "@/features/checkout/backend/legal-evidence-event.repository";
import type { OperationalEventRepository as OperationalEventRepositoryType } from "@/features/checkout/backend/operational-event.repository";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import type { WorkspaceTableAssignmentService as WorkspaceTableAssignmentServiceType } from "@/features/checkout/backend/workspace-table-assignment.service";
import type {
  IWorkspaceAvailabilityInventoryService,
  WorkspaceAvailabilityService as WorkspaceAvailabilityServiceType,
} from "@/features/reservation/backend/workspace-availability.service";
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
    const { WorkspaceTableAssignmentService } = await import(
      "@/features/checkout/backend/workspace-table-assignment.service"
    );
    const {
      WorkspaceAvailabilityInventoryService,
      WorkspaceAvailabilityService,
    } = await import(
      "@/features/reservation/backend/workspace-availability.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );

    const ensureAvailable = mock(() => Effect.void);
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
    const attachHold = mock(() => Effect.void);
    const invalidateAdvisory = mock(() => Effect.void);
    const recordMany = mock((input) => Effect.succeed(input as never));
    const createReservation = mock(() =>
      Effect.succeed({ id: "dotypos-reservation-id" } as never)
    );
    const assignTableId = mock(() => Effect.succeed("table-id"));

    const result = await prepareWorkspacePayStateEffect({
      locale: "en-US",
      reservationIntentId: "intent-id",
      reservation,
      legalConsent: true,
    }).pipe(
      Effect.provide(
        Layer.succeed(WorkspaceAvailabilityService, {
          getAdvisoryAvailability: mock(() => Effect.die("unused")),
          getAvailability: mock(() => Effect.die("unused")),
          ensureAvailable,
        } satisfies WorkspaceAvailabilityServiceType)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceAvailabilityInventoryService, {
          invalidateAdvisory,
          loadAdvisory: mock(() => Effect.die("unused")),
          loadFresh: mock(() => Effect.die("unused")),
        } satisfies IWorkspaceAvailabilityInventoryService)
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
          cancelOrderHold: mock(() => Effect.void),
          sweepExpiredHolds: mock(() =>
            Effect.succeed({ cancelled: 0, failed: 0 })
          ),
        } satisfies ReservationHoldCleanupServiceType)
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
    expect(invalidateAdvisory).toHaveBeenCalledTimes(1);
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
});
