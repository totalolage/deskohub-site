import { Context, Effect, Layer } from "effect";
import type { DatabaseError } from "@/db/database.service";
import type { FulfillmentStatus, PaymentStatus } from "@/db/schema";
import {
  PaymentOrderRepository,
  PaymentOrderRepositoryLive,
} from "@/features/checkout/backend/payment-order.repository";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";

export type CheckoutStatusReturnOutcome = "success" | "cancelled" | "unknown";

export type CheckoutStatusKind =
  | "not_found"
  | "created"
  | "pending"
  | "paid_waiting_fulfillment"
  | "fulfilled"
  | "fulfillment_failed"
  | "payment_failed"
  | "cancelled"
  | "expired";

export type CheckoutStatusViewModel = {
  readonly orderId: string;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
  readonly status: CheckoutStatusKind;
  readonly paymentStatus?: PaymentStatus;
  readonly fulfillmentStatus?: FulfillmentStatus;
  readonly checkoutDetails?: CheckoutDetailsJson;
};

export interface CheckoutStatusService {
  readonly getStatus: (input: {
    readonly orderId: string;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) => Effect.Effect<CheckoutStatusViewModel, DatabaseError>;
}

export const CheckoutStatusService = Context.GenericTag<CheckoutStatusService>(
  "CheckoutStatusService"
);

const toCheckoutStatusKind = (
  paymentStatus: PaymentStatus,
  fulfillmentStatus: FulfillmentStatus
): CheckoutStatusKind => {
  if (paymentStatus === "paid") {
    switch (fulfillmentStatus) {
      case "fulfilled":
        return "fulfilled";
      case "failed":
        return "fulfillment_failed";
      case "not_started":
        return "paid_waiting_fulfillment";
    }
  }

  switch (paymentStatus) {
    case "created":
      return "created";
    case "payment_pending":
      return "pending";
    case "payment_failed":
      return "payment_failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
  }
};

export const CheckoutStatusServiceLive = Layer.effect(
  CheckoutStatusService,
  Effect.gen(function* () {
    const paymentOrders = yield* PaymentOrderRepository;

    return CheckoutStatusService.of({
      getStatus: Effect.fn("checkoutStatus.getStatus")(
        function* (input) {
          const order = yield* paymentOrders.findById(input.orderId);

          if (!order) {
            return {
              orderId: input.orderId,
              returnOutcome: input.returnOutcome,
              status: "not_found",
            } satisfies CheckoutStatusViewModel;
          }

          return {
            orderId: order.id,
            returnOutcome: input.returnOutcome,
            status: toCheckoutStatusKind(
              order.paymentStatus,
              order.fulfillmentStatus
            ),
            paymentStatus: order.paymentStatus,
            fulfillmentStatus: order.fulfillmentStatus,
            checkoutDetails: order.checkoutDetails,
          } satisfies CheckoutStatusViewModel;
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
      ),
    });
  })
);

export const CheckoutStatusServiceLiveWithDependencies =
  CheckoutStatusServiceLive.pipe(Layer.provide(PaymentOrderRepositoryLive));
