import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { IWorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationEmailService as WorkspaceReservationEmailServiceType } from "./workspace-reservation-email.service";

describe("WorkspacePaidFulfillmentService", () => {
  test("repairs a stale local marker after live confirmation and resumes delivery", async () => {
    const {
      PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS,
      WorkspacePaidFulfillmentService,
      WorkspacePaidFulfillmentServiceLive,
    } = await import("./paid-fulfillment.service");
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
      updatedAt: Temporal.Now.instant().subtract({
        milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS + 1000,
      }),
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
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const claimPaidFulfillment = mock(() => Effect.succeed(claimed as never));
    const confirmReservation = mock(() =>
      Effect.die("already confirmed reservations do not call Dotypos")
    );
    const getReservationStatus = mock(() =>
      Effect.succeed("CONFIRMED" as const)
    );
    const markReservationConfirmed = mock(() => Effect.void);
    const sendPaidReservationEmails = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.die("Resend webhook fulfills"));

    await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      yield* service.fulfillPaidOrder({ orderId: "reservation-id" });
    }).pipe(
      Effect.provide(
        WorkspacePaidFulfillmentServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                claimPaidFulfillment,
                markReservationConfirmed,
                markFulfilled,
                markFulfillmentFailed: mock(() => Effect.void),
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(DotyposService, {
                confirmReservation,
                getReservationStatus,
              } as unknown as typeof DotyposService.Service),
              Layer.succeed(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.succeed(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies WorkspaceReservationEmailServiceType),
              Layer.succeed(PostHogEventService, {
                capture: mock(() => Effect.void),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(claimPaidFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        staleProcessingBefore: expect.any(Temporal.Instant),
      })
    );
    expect(confirmReservation).not.toHaveBeenCalled();
    expect(getReservationStatus).toHaveBeenCalledWith("dotypos-reservation-id");
    expect(markReservationConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
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
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const confirmReservation = mock(() =>
      Effect.succeed({ status: "CONFIRMED" as const })
    );
    const getReservationStatus = mock(() => Effect.succeed("NEW" as const));
    const markReservationConfirmed = mock(() => Effect.void);
    const sendPaidReservationEmails = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.die("Resend webhook fulfills"));

    await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      yield* service.fulfillPaidOrder({ orderId: "reservation-id" });
    }).pipe(
      Effect.provide(
        WorkspacePaidFulfillmentServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markReservationConfirmed,
                markFulfilled,
                markFulfillmentFailed: mock(() => Effect.void),
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(DotyposService, {
                confirmReservation,
                getReservationStatus,
              } as unknown as typeof DotyposService.Service),
              Layer.succeed(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.succeed(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies WorkspaceReservationEmailServiceType),
              Layer.succeed(PostHogEventService, {
                capture: mock(() => Effect.void),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(confirmReservation).toHaveBeenCalledWith("dotypos-reservation-id");
    expect(getReservationStatus).toHaveBeenCalledWith("dotypos-reservation-id");
    expect(markReservationConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
    });
    expect(markFulfilled).not.toHaveBeenCalled();
  });

  test("retains cancelled live paid reservations without delivery or compensation", async () => {
    const {
      WorkspacePaidFulfillmentService,
      WorkspacePaidFulfillmentServiceLive,
    } = await import("./paid-fulfillment.service");
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
      fulfillmentState: "failed",
    };
    const claimed = {
      ...order,
      reservationState: "held",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    };
    const markFulfillmentFailed = mock(() => Effect.void);
    const getReservation = mock(() =>
      Effect.die("unconfirmable reservations must not load delivery data")
    );
    const sendPaidReservationEmails = mock(() =>
      Effect.die("unconfirmable reservations must not be delivered")
    );
    const result = await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      return yield* service.fulfillPaidOrder({ orderId: "reservation-id" });
    }).pipe(
      Effect.result,
      Effect.provide(
        WorkspacePaidFulfillmentServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markReservationConfirmed: mock(() => Effect.void),
                markFulfilled: mock(() => Effect.void),
                markFulfillmentFailed,
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(DotyposService, {
                getReservationStatus: mock(() =>
                  Effect.succeed("CANCELLED" as const)
                ),
                confirmReservation: mock(() =>
                  Effect.die("cancelled reservations cannot be confirmed")
                ),
              } as unknown as typeof DotyposService.Service),
              Layer.succeed(WorkspaceReservationService, {
                getReservation,
              } satisfies IWorkspaceReservationService),
              Layer.succeed(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies WorkspaceReservationEmailServiceType),
              Layer.succeed(PostHogEventService, {
                capture: mock(() => Effect.void),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toMatchObject({
        failureCode: "dotypos_reservation_unfulfillable",
      });
    }
    expect(markFulfillmentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        failureCode: "dotypos_reservation_unfulfillable",
      })
    );
    expect(getReservation).not.toHaveBeenCalled();
    expect(sendPaidReservationEmails).not.toHaveBeenCalled();
  });
});
