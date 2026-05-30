import {
  classifyNexiFailureStatus,
  getNexiPaymentMetadata,
  NexiApi,
  type NexiCurrency,
  NexiService,
} from "@deskohub/nexi";
import { Context, Effect, Layer, Schema } from "effect";
import type { DatabaseError } from "@/db/database.service";
import type { FulfillmentStatus, PaymentStatus } from "@/db/schema";
import { NexiAmountFromWorkspaceMoney } from "@/features/checkout/backend/nexi-amount.codec";
import {
  PaymentOrderRepository,
  PaymentOrderRepositoryLive,
} from "@/features/checkout/backend/payment-order.repository";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { NexiRuntimeConfigLive } from "@/shared/backend/config/nexi.config";

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
  readonly recordProviderReturn: (input: {
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
      case "processing":
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

const toNexiAmount = Schema.encode(NexiAmountFromWorkspaceMoney);

export const CheckoutStatusServiceLive = Layer.effect(
  CheckoutStatusService,
  Effect.gen(function* () {
    const paymentOrders = yield* PaymentOrderRepository;
    const nexi = yield* NexiService;

    const getStatus = Effect.fn("checkoutStatus.getStatus")(
      function* (input: {
        readonly orderId: string;
        readonly returnOutcome: CheckoutStatusReturnOutcome;
      }) {
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
    );

    return CheckoutStatusService.of({
      getStatus,
      recordProviderReturn: Effect.fn("checkoutStatus.recordProviderReturn")(
        function* (input) {
          const order = yield* paymentOrders.findById(input.orderId);

          if (!order) {
            return {
              orderId: input.orderId,
              returnOutcome: input.returnOutcome,
              status: "not_found",
            } satisfies CheckoutStatusViewModel;
          }

          if (
            ["created", "payment_pending"].includes(order.paymentStatus) &&
            order.securityToken
          ) {
            const expectedAmount = yield* toNexiAmount(
              order.checkoutDetails.payment.expectedPrice
            ).pipe(Effect.orDie);
            const verification = yield* nexi
              .verifyPaymentOutcome({
                orderId: order.id,
                correlationId: order.correlationId,
                amount: expectedAmount.amount,
                currency: expectedAmount.currency as NexiCurrency,
                securityToken: order.securityToken,
              })
              .pipe(Effect.orElseSucceed(() => undefined));

            if (
              verification?.status === "failure" &&
              verification.mismatches.length === 0
            ) {
              const { providerOperationId, providerStatus } =
                getNexiPaymentMetadata(verification);
              const failureKind = classifyNexiFailureStatus(providerStatus);
              const markTerminal =
                failureKind === "cancelled"
                  ? paymentOrders.markCancelled
                  : failureKind === "expired"
                    ? paymentOrders.markExpired
                    : paymentOrders.markFailed;

              yield* markTerminal({
                id: order.id,
                failureCode: "nexi_payment_failed",
                providerOperationId,
                providerStatus,
              }).pipe(Effect.orElseSucceed(() => undefined));
            }
          }

          return yield* getStatus(input);
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
      ),
    });
  })
);

export const CheckoutStatusServiceLiveWithDependencies =
  CheckoutStatusServiceLive.pipe(
    Layer.provide(PaymentOrderRepositoryLive),
    Layer.provide(
      Layer.provide(
        NexiService.Default,
        Layer.provide(NexiApi.Default, NexiRuntimeConfigLive)
      )
    )
  );
