import { Context, Effect, Layer, Match } from "effect";
import {
  type ReservationInvoiceProcessingError,
  ReservationInvoiceService,
} from "@/features/accounting/backend/reservation-invoice.service";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { OrderId, OrderKind } from "@/features/order";
import type { WorkspaceReservationStateError } from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  type WorkspacePaidFulfillmentError,
  WorkspacePaidFulfillmentService,
} from "./paid-fulfillment.service";

type PaidOrderCompletionError =
  | ReservationInvoiceProcessingError
  | WorkspacePaidFulfillmentError
  | WorkspaceReservationStateError;

export interface IPaidOrderCompletionService {
  readonly complete: (input: {
    readonly orderId: OrderId;
    readonly kind: OrderKind;
    readonly paymentAttemptId: PaymentAttemptId;
  }) => Effect.Effect<void, PaidOrderCompletionError>;
}

export class PaidOrderCompletionService extends Context.Service<
  PaidOrderCompletionService,
  IPaidOrderCompletionService
>()("PaidOrderCompletionService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const fulfillment = yield* WorkspacePaidFulfillmentService;
      const invoices = yield* ReservationInvoiceService;

      return PaidOrderCompletionService.of({
        complete: Effect.fn("paidOrderCompletion.complete")(function* (input) {
          yield* Match.value(input.kind).pipe(
            Match.when("reservation", () =>
              fulfillment.fulfillPaidOrder({
                orderId: workspaceReservationIdSchema.make(input.orderId),
              })
            ),
            Match.when("goods", () =>
              invoices.processByPaymentAttemptId({
                paymentAttemptId: input.paymentAttemptId,
              })
            ),
            Match.exhaustive
          );
        }),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspacePaidFulfillmentService.Live),
    Layer.provide(ReservationInvoiceService.Live)
  );
}
