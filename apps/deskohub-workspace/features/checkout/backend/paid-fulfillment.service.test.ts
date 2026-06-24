import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { OperationalEventRepository as OperationalEventRepositoryType } from "@/features/checkout/backend/operational-event.repository";
import type { WorkspaceReservationEmailService as WorkspaceReservationEmailServiceType } from "@/features/checkout/backend/workspace-reservation-email.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { IWorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";

describe("WorkspacePaidFulfillmentService", () => {
  test("retries stale processing paid orders and waits for delivery before fulfillment", async () => {
    const {
      PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS,
      WorkspacePaidFulfillmentService,
      WorkspacePaidFulfillmentServiceLive,
    } = await import("./paid-fulfillment.service");
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
    );
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { WorkspaceReservationService } = await import(
      "@/features/reservation/backend/workspace-reservation.service"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );

    const order = {
      id: "reservation-id",
      paymentState: "paid",
      fulfillmentState: "processing",
      updatedAt: new Date(
        Date.now() - PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS - 1000
      ),
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    };
    const emailReservation = {
      ...claimed,
      customer: { email: "customer@example.com" },
      reservedFrom: new Date("2026-07-01T08:00:00.000Z"),
      reservedUntil: new Date("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const claimPaidFulfillment = mock(() => Effect.succeed(claimed as never));
    const confirmReservation = mock(() =>
      Effect.die("already confirmed reservations do not call Dotypos")
    );
    const markReservationConfirmed = mock(() =>
      Effect.die("already confirmed reservations do not update confirmation")
    );
    const sendPaidReservationEmails = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.die("Resend webhook fulfills"));

    await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      yield* service.fulfillPaidOrder({ orderId: "reservation-id" });
    }).pipe(
      Effect.provide(WorkspacePaidFulfillmentServiceLive),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, {
          findById: mock(() => Effect.succeed(order as never)),
          claimPaidFulfillment,
          markReservationConfirmed,
          markFulfilled,
          markFulfillmentFailed: mock(() => Effect.void),
        } as unknown as WorkspaceReservationRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(OperationalEventRepository, {
          record: mock(() => Effect.die("should not record failure")),
        } as unknown as OperationalEventRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          confirmReservation,
        } as unknown as typeof DotyposService.Service)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationService, {
          getReservation: mock(() => Effect.succeed(emailReservation as never)),
        } satisfies IWorkspaceReservationService)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationEmailService, {
          sendPaidReservationEmails,
        } satisfies WorkspaceReservationEmailServiceType)
      ),
      Effect.provide(
        Layer.succeed(PostHogEventService, { capture: mock(() => Effect.void) })
      ),
      Effect.runPromise
    );

    expect(claimPaidFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        staleProcessingBefore: expect.any(Date),
      })
    );
    expect(confirmReservation).not.toHaveBeenCalled();
    expect(markReservationConfirmed).not.toHaveBeenCalled();
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
    });
    expect(markFulfilled).not.toHaveBeenCalled();
  });

  test("confirms held paid orders, sends emails, and waits for delivery before fulfillment", async () => {
    const {
      WorkspacePaidFulfillmentService,
      WorkspacePaidFulfillmentServiceLive,
    } = await import("./paid-fulfillment.service");
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
    );
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { WorkspaceReservationService } = await import(
      "@/features/reservation/backend/workspace-reservation.service"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );

    const order = {
      id: "reservation-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimed = {
      ...order,
      reservationState: "held",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    };
    const emailReservation = {
      ...claimed,
      customer: { email: "customer@example.com" },
      reservedFrom: new Date("2026-07-01T08:00:00.000Z"),
      reservedUntil: new Date("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const confirmReservation = mock(() => Effect.void);
    const markReservationConfirmed = mock(() => Effect.void);
    const sendPaidReservationEmails = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.die("Resend webhook fulfills"));

    await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      yield* service.fulfillPaidOrder({ orderId: "reservation-id" });
    }).pipe(
      Effect.provide(WorkspacePaidFulfillmentServiceLive),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, {
          findById: mock(() => Effect.succeed(order as never)),
          claimPaidFulfillment: mock(() => Effect.succeed(claimed as never)),
          markReservationConfirmed,
          markFulfilled,
          markFulfillmentFailed: mock(() => Effect.void),
        } as unknown as WorkspaceReservationRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(OperationalEventRepository, {
          record: mock(() => Effect.die("should not record failure")),
        } as unknown as OperationalEventRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          confirmReservation,
        } as unknown as typeof DotyposService.Service)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationService, {
          getReservation: mock(() => Effect.succeed(emailReservation as never)),
        } satisfies IWorkspaceReservationService)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationEmailService, {
          sendPaidReservationEmails,
        } satisfies WorkspaceReservationEmailServiceType)
      ),
      Effect.provide(
        Layer.succeed(PostHogEventService, { capture: mock(() => Effect.void) })
      ),
      Effect.runPromise
    );

    expect(confirmReservation).toHaveBeenCalledWith("dotypos-reservation-id");
    expect(markReservationConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
    });
    expect(markFulfilled).not.toHaveBeenCalled();
  });
});
