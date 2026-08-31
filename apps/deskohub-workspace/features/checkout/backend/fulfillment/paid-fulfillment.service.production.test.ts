import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect, Layer } from "effect";
import { env, getAccountingDocumentSnapshotSecret } from "@/env";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import type { IWorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { IWorkspaceReservationEmailService } from "./workspace-reservation-email.service";

mock.module("server-only", () => ({}));

// The workspace env object bakes VERCEL_ENV at first import, so the accepted
// delivery branch is exercised through a retroactive override of "@/env" that
// only replaces VERCEL_ENV and delegates every other field to the real env.
mock.module("@/env", () => ({
  env: new Proxy(env, {
    get: (target, key) =>
      key === "VERCEL_ENV" ? "production" : Reflect.get(target, key),
  }),
  getAccountingDocumentSnapshotSecret,
}));

const { WorkspaceCheckoutAccessCodeService } = await import(
  "@/features/checkout/backend/reservation/access-code.service"
);
const { WorkspacePaidFulfillmentService } = await import(
  "./paid-fulfillment.service"
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

describe("WorkspacePaidFulfillmentService production email acceptance", () => {
  test("records the accepted delivery id and leaves fulfillment awaiting the webhook", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
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
    const customerEmailDeliveryId = EmailDeliveryIdSchema.make(
      "accepted-production-email-delivery"
    );
    const sendPaidReservationEmails = mock(() =>
      Effect.succeed(customerEmailDeliveryId)
    );
    const markAwaitingCustomerEmailDelivery = mock(() => Effect.void);
    const markFulfilled = mock(() =>
      Effect.die("production fulfillment must stay awaiting delivery")
    );
    const processInvoice = mock(() =>
      Effect.die("production acceptance must not process invoices")
    );

    const result = await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      return yield* service
        .fulfillPaidOrder({ orderId: "reservation-id" })
        .pipe(Effect.result);
    }).pipe(
      Effect.provide(
        WorkspacePaidFulfillmentService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markAwaitingCustomerEmailDelivery,
                markFulfilled,
                markFulfillmentFailed: mock(() =>
                  Effect.die("production acceptance must not fail fulfillment")
                ),
              }),
              Layer.mock(DotyposService, {}),
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

    const { env: productionEnv } = await import("@/env");
    expect(productionEnv.VERCEL_ENV).toBe("production");
    expect(result._tag).toBe("Success");
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
    });
    expect(markAwaitingCustomerEmailDelivery).toHaveBeenCalledWith({
      id: "reservation-id",
      customerEmailDeliveryId,
    });
    expect(markFulfilled).not.toHaveBeenCalled();
    expect(processInvoice).not.toHaveBeenCalled();
  });
});
