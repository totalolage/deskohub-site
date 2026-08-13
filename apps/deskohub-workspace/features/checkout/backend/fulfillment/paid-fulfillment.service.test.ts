import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice";
import { WorkspaceCheckoutAccessCodeService } from "@/features/checkout/backend/reservation/access-code.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { IWorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { IWorkspaceReservationEmailService } from "./workspace-reservation-email.service";

describe("WorkspacePaidFulfillmentService", () => {
  test("retries stale processing paid orders and completes non-production fulfillment after send acceptance", async () => {
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
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "processing",
      updatedAt: Temporal.Now.instant().subtract({
        milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS + 1000,
      }),
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
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: "customer@example.com" },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const claimPaidFulfillment = mock(() => Effect.succeed(claimed as never));
    const confirmReservation = mock(() =>
      Effect.die("already confirmed reservations do not call Dotypos")
    );
    const markReservationConfirmed = mock(() =>
      Effect.die("already confirmed reservations do not update confirmation")
    );
    const deliverySteps: string[] = [];
    const sendPaidReservationEmails = mock(() =>
      Effect.sync(() => {
        deliverySteps.push("email");
      })
    );
    const resolveCustomerAccessCode = mock(() =>
      Effect.sync(() => {
        deliverySteps.push("access");
        return "access-code";
      })
    );
    const markFulfilled = mock(() => Effect.void);
    const processInvoice = mock(() => Effect.void);

    await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      yield* service.fulfillPaidOrder({ orderId: "reservation-id" });
    }).pipe(
      Effect.provide(
        WorkspacePaidFulfillmentServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                claimPaidFulfillment,
                markReservationConfirmed,
                markFulfilled,
                markFulfillmentFailed: mock(() => Effect.void),
              }),
              Layer.mock(DotyposService, {
                confirmReservation,
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode,
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: processInvoice,
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
    expect(markReservationConfirmed).not.toHaveBeenCalled();
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
    });
    expect(resolveCustomerAccessCode).toHaveBeenCalledWith({
      reservationId: emailReservation.id,
      dotyposReservationId: emailReservation.dotyposReservationId,
      reservedFrom: emailReservation.reservedFrom,
      reservedUntil: emailReservation.reservedUntil,
    });
    expect(deliverySteps).toEqual(["access", "email"]);
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
    expect(processInvoice).toHaveBeenCalledWith({
      paymentAttemptId: "payment-attempt-id",
    });
  });

  test("confirms held paid orders, sends emails, and completes non-production fulfillment", async () => {
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
      activePaymentAttemptId: "payment-attempt-id",
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
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: "customer@example.com" },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const confirmReservation = mock(() => Effect.void);
    const markReservationConfirmed = mock(() => Effect.void);
    const sendPaidReservationEmails = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.void);
    const processInvoice = mock(() => Effect.void);

    await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      yield* service.fulfillPaidOrder({ orderId: "reservation-id" });
    }).pipe(
      Effect.provide(
        WorkspacePaidFulfillmentServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markReservationConfirmed,
                markFulfilled,
                markFulfillmentFailed: mock(() => Effect.void),
              }),
              Layer.mock(DotyposService, {
                confirmReservation,
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.succeed("access-code")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: processInvoice,
              })
            )
          )
        )
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
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
    expect(processInvoice).toHaveBeenCalledWith({
      paymentAttemptId: "payment-attempt-id",
    });
  });

  test("retries invoice processing without reverting completed access fulfillment", async () => {
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
    const invoiceFailure = new Error("synthetic invoice failure");
    const processInvoice = mock(() => Effect.fail(invoiceFailure));
    const markFulfillmentFailed = mock(() => Effect.void);
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "fulfilled",
    };

    const result = await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      return yield* service
        .fulfillPaidOrder({ orderId: "reservation-id" })
        .pipe(Effect.result);
    }).pipe(
      Effect.provide(
        WorkspacePaidFulfillmentServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                markFulfillmentFailed,
              }),
              Layer.mock(DotyposService, {}),
              Layer.mock(WorkspaceReservationService, {}),
              Layer.mock(WorkspaceReservationEmailService, {}),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: processInvoice,
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "WorkspacePaidFulfillmentError",
        failureCode: "invoice_processing_failed",
        cause: invoiceFailure,
      },
    });
    expect(markFulfillmentFailed).not.toHaveBeenCalled();
  });

  test("releases the fulfillment claim after an unexpected infrastructure failure", async () => {
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
    const connectionFailure = new Error("database connection unavailable");
    const markFulfillmentFailed = mock(() => Effect.void);

    const result = await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      return yield* service
        .fulfillPaidOrder({ orderId: "reservation-id" })
        .pipe(Effect.result);
    }).pipe(
      Effect.provide(
        WorkspacePaidFulfillmentServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markReservationConfirmed: mock(() =>
                  Effect.fail(connectionFailure)
                ),
                markFulfilled: mock(() => Effect.void),
                markFulfillmentFailed,
              }),
              Layer.mock(DotyposService, {
                confirmReservation: mock(() => Effect.void),
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.die("email flow should not start")
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails: mock(() =>
                  Effect.die("email flow should not start")
                ),
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.die("access flow should not start")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("invoice processing should not start")
                ),
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
        _tag: "WorkspacePaidFulfillmentError",
        failureCode: "fulfillment_completion_failed",
        cause: connectionFailure,
      });
    }
    expect(markFulfillmentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        failureCode: "fulfillment_completion_failed",
      })
    );
  });
});
