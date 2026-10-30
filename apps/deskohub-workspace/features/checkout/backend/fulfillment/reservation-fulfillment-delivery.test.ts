import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect, Layer } from "effect";
import type { ReservationInvoiceService as ReservationInvoices } from "@/features/accounting/backend/reservation-invoice.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { CapturePostHogEventInput } from "@/shared/backend/analytics/posthog-event.service";
import type { IFulfillmentLedger } from "./fulfillment-ledger.repository";
import type { ReservationAccessDeliveryReport } from "./reservation-fulfillment.service";

// Services load after the test environment's module mocks.
const { DotyposService } = await import("@deskohub/dotypos");
const { CustomerEmailLocaleService, ReservationAuthorDirectory } = await import(
  "@/features/account"
);
const { ReservationInvoiceService } = await import(
  "@/features/accounting/backend/reservation-invoice.service"
);
const { WorkspaceCheckoutAccessCodeService } = await import(
  "@/features/checkout/backend/reservation/access-code.service"
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
const { FulfillmentLedger } = await import("./fulfillment-ledger.repository");
const { ReservationFulfillment } = await import(
  "./reservation-fulfillment.service"
);
const { WorkspaceReservationEmailService } = await import(
  "./workspace-reservation-email.service"
);

const customerEmailDeliveryId = EmailDeliveryIdSchema.make("resend-email-id");
const reservationId = workspaceReservationIdSchema.make("reservation-id");
const reportedAt = Temporal.Instant.from("2026-01-01T12:05:00.000Z");

const awaitingDeliveryReservation = {
  id: "reservation-id",
  activePaymentAttemptId: "payment-attempt-id",
  paymentState: "paid",
  fulfillmentState: "awaiting_delivery",
  fulfillmentFailureCode: null,
};

const fulfilledReservation = {
  ...awaitingDeliveryReservation,
  dotyposReservationId: "dotypos-reservation-id",
  dotyposCustomerId: "dotypos-customer-id",
  fulfillmentState: "fulfilled",
};

const deliveryReport = (
  overrides: Partial<ReservationAccessDeliveryReport> = {}
): ReservationAccessDeliveryReport => ({
  deliveryId: customerEmailDeliveryId,
  outcome: "delivered",
  occurredAt: reportedAt,
  accessEmail: { reservationId },
  ...overrides,
});

const recordDelivery = (input: {
  readonly ledger: Partial<IFulfillmentLedger>;
  readonly report: ReservationAccessDeliveryReport;
  readonly posthogCapture?: (
    input: CapturePostHogEventInput
  ) => Effect.Effect<void>;
  readonly processInvoice?: ReservationInvoices["Service"]["processByPaymentAttemptId"];
}) =>
  Effect.gen(function* () {
    const fulfillment = yield* ReservationFulfillment;
    return yield* fulfillment.recordDelivery(input.report);
  }).pipe(
    Effect.provide(
      ReservationFulfillment.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(FulfillmentLedger, input.ledger),
            Layer.mock(PostHogEventService, {
              capture: input.posthogCapture ?? (() => Effect.void),
            }),
            Layer.mock(ReservationInvoiceService, {
              processByPaymentAttemptId:
                input.processInvoice ?? (() => Effect.void),
            }),
            // Delivery reports never run fulfillment.
            Layer.mock(WorkspaceReservationRepository, {}),
            Layer.mock(DotyposService, {}),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(CustomerEmailLocaleService, {}),
            Layer.mock(WorkspaceReservationService, {}),
            Layer.mock(WorkspaceCheckoutAccessCodeService, {}),
            Layer.mock(ReservationAuthorDirectory, {})
          )
        )
      )
    )
  );

const untouchedDelivery = () => ({
  markCustomerEmailDeliveryFulfilled: mock(() =>
    Effect.die("should not update delivery")
  ),
  markCustomerEmailDeliveryFailed: mock(() =>
    Effect.die("should not update delivery")
  ),
});

describe("ReservationFulfillment.recordDelivery", () => {
  test("completes an awaiting delivery, emits reservation fulfilled and issues the invoice", async () => {
    const capture = mock((_input: CapturePostHogEventInput) => Effect.void);
    const processInvoice = mock(() => Effect.void);
    const markFulfilled = mock(() =>
      Effect.succeed(fulfilledReservation as never)
    );
    const markDeliveryFailed = mock(() =>
      Effect.die("should not fail fulfillment")
    );
    const ledger = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed(awaitingDeliveryReservation as never)
      ),
      markCustomerEmailDeliveryFulfilled: markFulfilled,
      markCustomerEmailDeliveryFailed: markDeliveryFailed,
    };

    const outcome = await Effect.runPromise(
      recordDelivery({
        ledger,
        report: deliveryReport(),
        posthogCapture: capture,
        processInvoice,
      })
    );

    expect(outcome).toBe("applied");
    expect(ledger.findByActiveCustomerEmailDeliveryId).toHaveBeenCalledWith(
      customerEmailDeliveryId
    );
    expect(markDeliveryFailed).not.toHaveBeenCalled();
    expect(markFulfilled).toHaveBeenCalledWith({
      customerEmailDeliveryId,
      fulfilledAt: reportedAt,
    });
    const [capturedEvent] = capture.mock.calls[0] ?? [];
    expect(capturedEvent).toMatchObject({ event: "reservation fulfilled" });
    expect(
      Temporal.Instant.compare(
        capturedEvent?.timestamp as Temporal.Instant,
        reportedAt
      )
    ).toBe(0);
    expect(processInvoice).toHaveBeenCalledWith({
      paymentAttemptId: "payment-attempt-id",
    });
  });

  test("retries the invoice for an already fulfilled reservation", async () => {
    const invoiceFailure = new Error("synthetic invoice failure");
    const processInvoice = mock(() => Effect.fail(invoiceFailure as never));
    const capture = mock((_input: CapturePostHogEventInput) => Effect.void);
    const markFulfilled = mock(() => Effect.die("should not re-fulfill"));

    const error = await Effect.runPromise(
      Effect.flip(
        recordDelivery({
          ledger: {
            findByActiveCustomerEmailDeliveryId: mock(() =>
              Effect.succeed(fulfilledReservation as never)
            ),
            markCustomerEmailDeliveryFulfilled: markFulfilled,
          },
          report: deliveryReport(),
          posthogCapture: capture,
          processInvoice,
        })
      )
    );

    expect(error).toMatchObject({
      _tag: "ReservationDeliveryReportError",
      reason: "invoice_processing_failed",
      workspaceReservationId: "reservation-id",
      cause: invoiceFailure,
    });
    expect(processInvoice).toHaveBeenCalledWith({
      paymentAttemptId: "payment-attempt-id",
    });
    expect(markFulfilled).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  test("ignores an already fulfilled reservation once its invoice is issued", async () => {
    const outcome = await Effect.runPromise(
      recordDelivery({
        ledger: {
          findByActiveCustomerEmailDeliveryId: mock(() =>
            Effect.succeed(fulfilledReservation as never)
          ),
          ...untouchedDelivery(),
        },
        report: deliveryReport(),
      })
    );

    expect(outcome).toEqual({ ignored: "reservation_already_fulfilled" });
  });

  test("repairs a failed delivery only for the fulfillment email failure code", async () => {
    const markFulfilled = mock(() =>
      Effect.succeed(fulfilledReservation as never)
    );

    const outcome = await Effect.runPromise(
      recordDelivery({
        ledger: {
          findByActiveCustomerEmailDeliveryId: mock(() =>
            Effect.succeed({
              ...awaitingDeliveryReservation,
              fulfillmentState: "failed",
              fulfillmentFailureCode: "fulfillment_email_failed",
            } as never)
          ),
          markCustomerEmailDeliveryFulfilled: markFulfilled,
          markCustomerEmailDeliveryFailed: mock(() =>
            Effect.die("should not fail delivery")
          ),
        },
        report: deliveryReport(),
      })
    );

    expect(outcome).toBe("applied");
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmailDeliveryId })
    );
  });

  test("does not repair a failed delivery with a different failure code", async () => {
    const ledger = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed({
          ...awaitingDeliveryReservation,
          fulfillmentState: "failed",
          fulfillmentFailureCode: "fulfillment_dotypos_failed",
        } as never)
      ),
      ...untouchedDelivery(),
    };

    const outcome = await Effect.runPromise(
      recordDelivery({ ledger, report: deliveryReport() })
    );

    expect(outcome).toEqual({ ignored: "reservation_already_failed" });
    expect(ledger.markCustomerEmailDeliveryFulfilled).not.toHaveBeenCalled();
  });

  test("fails a fulfilled delivery when a failure report reaches the ledger", async () => {
    const failedAt = Temporal.Instant.from("2026-01-01T12:10:00.000Z");
    const markDeliveryFailed = mock(() =>
      Effect.succeed({
        ...awaitingDeliveryReservation,
        fulfillmentState: "failed",
        fulfillmentFailureCode: "fulfillment_email_failed",
        fulfillmentFailedAt: failedAt,
      } as never)
    );

    const outcome = await Effect.runPromise(
      recordDelivery({
        ledger: {
          findByActiveCustomerEmailDeliveryId: mock(() =>
            Effect.succeed({
              ...fulfilledReservation,
              fulfilledAt: Temporal.Instant.from("2026-01-01T12:00:00.000Z"),
            } as never)
          ),
          markCustomerEmailDeliveryFulfilled: mock(() =>
            Effect.die("should not update delivery")
          ),
          markCustomerEmailDeliveryFailed: markDeliveryFailed,
        },
        report: deliveryReport({ outcome: "failed", occurredAt: failedAt }),
      })
    );

    expect(outcome).toBe("applied");
    expect(markDeliveryFailed).toHaveBeenCalledWith({
      customerEmailDeliveryId,
      failureCode: "fulfillment_email_failed",
      failedAt,
    });
  });

  test("ignores a failure report the ledger finds older than the fulfillment", async () => {
    const capture = mock((_input: CapturePostHogEventInput) => Effect.void);
    const markDeliveryFailed = mock(() => Effect.succeed(null));

    const outcome = await Effect.runPromise(
      recordDelivery({
        ledger: {
          findByActiveCustomerEmailDeliveryId: mock(() =>
            Effect.succeed({
              ...fulfilledReservation,
              fulfilledAt: Temporal.Instant.from("2026-01-01T12:10:00.000Z"),
            } as never)
          ),
          markCustomerEmailDeliveryFulfilled: mock(() =>
            Effect.die("should not update delivery")
          ),
          markCustomerEmailDeliveryFailed: markDeliveryFailed,
        },
        report: deliveryReport({ outcome: "failed" }),
        posthogCapture: capture,
      })
    );

    expect(outcome).toEqual({ ignored: "reservation_delivery_state_changed" });
    expect(markDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmailDeliveryId, failedAt: reportedAt })
    );
    expect(capture).not.toHaveBeenCalled();
  });

  test("cannot clear a newer delivery failure with a delayed success report", async () => {
    const capture = mock((_input: CapturePostHogEventInput) => Effect.void);
    const processInvoice = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.succeed(null));

    const outcome = await Effect.runPromise(
      recordDelivery({
        ledger: {
          findByActiveCustomerEmailDeliveryId: mock(() =>
            Effect.succeed({
              ...awaitingDeliveryReservation,
              fulfillmentState: "failed",
              fulfillmentFailureCode: "fulfillment_email_failed",
              fulfillmentFailedAt: Temporal.Instant.from(
                "2026-01-01T12:10:00.000Z"
              ),
            } as never)
          ),
          markCustomerEmailDeliveryFulfilled: markFulfilled,
          markCustomerEmailDeliveryFailed: mock(() =>
            Effect.die("should not fail delivery")
          ),
        },
        report: deliveryReport(),
        posthogCapture: capture,
        processInvoice,
      })
    );

    expect(outcome).toEqual({ ignored: "reservation_delivery_state_changed" });
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmailDeliveryId,
        fulfilledAt: reportedAt,
      })
    );
    expect(capture).not.toHaveBeenCalled();
    expect(processInvoice).not.toHaveBeenCalled();
  });

  test("records a failed delivery with the email failure code at the report time", async () => {
    const markDeliveryFailed = mock(() =>
      Effect.succeed(awaitingDeliveryReservation as never)
    );

    const outcome = await Effect.runPromise(
      recordDelivery({
        ledger: {
          findByActiveCustomerEmailDeliveryId: mock(() =>
            Effect.succeed(awaitingDeliveryReservation as never)
          ),
          markCustomerEmailDeliveryFailed: markDeliveryFailed,
        },
        report: deliveryReport({ outcome: "failed" }),
      })
    );

    expect(outcome).toBe("applied");
    expect(markDeliveryFailed).toHaveBeenCalledWith({
      customerEmailDeliveryId,
      failureCode: "fulfillment_email_failed",
      failedAt: reportedAt,
    });
  });

  test("asks for a retry when this deployment's access email is reported before its delivery is attached", async () => {
    const markFulfilled = mock(() =>
      Effect.succeed(fulfilledReservation as never)
    );
    const markDeliveryFailed = mock(() =>
      Effect.die("should not update delivery")
    );
    const ledger = {
      findByActiveCustomerEmailDeliveryId: mock(() => Effect.succeed(null)),
      markCustomerEmailDeliveryFulfilled: markFulfilled,
      markCustomerEmailDeliveryFailed: markDeliveryFailed,
    };

    const error = await Effect.runPromise(
      Effect.flip(recordDelivery({ ledger, report: deliveryReport() }))
    );

    expect(error).toMatchObject({
      _tag: "ReservationDeliveryReportError",
      reason: "delivery_unattached",
      workspaceReservationId: "reservation-id",
    });
    expect(markFulfilled).not.toHaveBeenCalled();
    expect(markDeliveryFailed).not.toHaveBeenCalled();

    const retried = await Effect.runPromise(
      recordDelivery({
        ledger: {
          ...ledger,
          findByActiveCustomerEmailDeliveryId: mock(() =>
            Effect.succeed(awaitingDeliveryReservation as never)
          ),
        },
        report: deliveryReport(),
      })
    );

    expect(retried).toBe("applied");
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmailDeliveryId })
    );
  });

  test("ignores an unknown delivery of another email", async () => {
    const ledger = {
      findByActiveCustomerEmailDeliveryId: mock(() => Effect.succeed(null)),
      ...untouchedDelivery(),
    };

    const outcome = await Effect.runPromise(
      recordDelivery({
        ledger,
        report: deliveryReport({ outcome: "failed", accessEmail: undefined }),
      })
    );

    expect(outcome).toEqual({ ignored: "unknown_email_delivery" });
    expect(ledger.findByActiveCustomerEmailDeliveryId).toHaveBeenCalledWith(
      customerEmailDeliveryId
    );
    expect(ledger.markCustomerEmailDeliveryFulfilled).not.toHaveBeenCalled();
    expect(ledger.markCustomerEmailDeliveryFailed).not.toHaveBeenCalled();
  });

  test.each([
    ["another email", undefined, "unrelated_email"],
    [
      "another reservation's access email",
      {
        reservationId: workspaceReservationIdSchema.make(
          "other-reservation-id"
        ),
      },
      "reservation_mismatch",
    ],
  ] as const)(
    "ignores an active delivery reported for %s",
    async (_, accessEmail, ignored) => {
      const ledger = {
        findByActiveCustomerEmailDeliveryId: mock(() =>
          Effect.succeed(awaitingDeliveryReservation as never)
        ),
        ...untouchedDelivery(),
      };

      const outcome = await Effect.runPromise(
        recordDelivery({ ledger, report: deliveryReport({ accessEmail }) })
      );

      expect(outcome).toEqual({ ignored });
      expect(ledger.markCustomerEmailDeliveryFulfilled).not.toHaveBeenCalled();
      expect(ledger.markCustomerEmailDeliveryFailed).not.toHaveBeenCalled();
    }
  );

  test("fails with a retryable error when the reservation cannot be loaded", async () => {
    const loadFailure = new Error("synthetic load failure");

    const error = await Effect.runPromise(
      Effect.flip(
        recordDelivery({
          ledger: {
            findByActiveCustomerEmailDeliveryId: mock(() =>
              Effect.fail(loadFailure as never)
            ),
          },
          report: deliveryReport(),
        })
      )
    );

    expect(error).toMatchObject({
      _tag: "ReservationDeliveryReportError",
      reason: "reservation_load_failed",
      cause: loadFailure,
    });
    expect(error.workspaceReservationId).toBeUndefined();
  });

  test.each([
    ["delivered", "markCustomerEmailDeliveryFulfilled"],
    ["failed", "markCustomerEmailDeliveryFailed"],
  ] as const)(
    "fails with a retryable error when a %s report cannot be recorded",
    async (outcome, transition) => {
      const updateFailure = new Error("synthetic update failure");

      const error = await Effect.runPromise(
        Effect.flip(
          recordDelivery({
            ledger: {
              findByActiveCustomerEmailDeliveryId: mock(() =>
                Effect.succeed(awaitingDeliveryReservation as never)
              ),
              [transition]: mock(() => Effect.fail(updateFailure as never)),
            },
            report: deliveryReport({ outcome }),
          })
        )
      );

      expect(error).toMatchObject({
        _tag: "ReservationDeliveryReportError",
        reason: "reservation_update_failed",
        workspaceReservationId: "reservation-id",
        cause: updateFailure,
      });
    }
  );
});
