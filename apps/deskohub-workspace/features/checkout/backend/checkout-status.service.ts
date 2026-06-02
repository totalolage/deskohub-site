import { DotyposService } from "@deskohub/dotypos";
import { NexiApi, NexiService } from "@deskohub/nexi";
import { Context, Effect, Layer } from "effect";
import {
  type DatabaseError,
  WorkspaceDatabaseLive,
} from "@/db/database.service";
import type { FulfillmentState, PaymentState } from "@/db/schema";
import { OperationalEventRepositoryLive } from "@/features/checkout/backend/operational-event.repository";
import { PaymentAttemptRepositoryLive } from "@/features/checkout/backend/payment-attempt.repository";
import {
  ProviderPaymentFinalizationService,
  ProviderPaymentFinalizationServiceLiveWithDependencies,
} from "@/features/checkout/backend/provider-payment-finalization.service";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/checkout/backend/workspace-reservation.repository";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
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
  readonly paymentStatus?: PaymentState;
  readonly fulfillmentStatus?: FulfillmentState;
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
  paymentState: PaymentState,
  fulfillmentState: FulfillmentState
): CheckoutStatusKind => {
  if (paymentState === "paid") {
    switch (fulfillmentState) {
      case "fulfilled":
        return "fulfilled";
      case "failed":
        return "fulfillment_failed";
      case "processing":
      case "not_started":
        return "paid_waiting_fulfillment";
    }
  }

  switch (paymentState) {
    case "not_started":
      return "created";
    case "pending":
      return "pending";
    case "failed":
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
    const reservations = yield* WorkspaceReservationRepository;
    const holdCleanup = yield* ReservationHoldCleanupService;
    const finalization = yield* ProviderPaymentFinalizationService;

    const getStatus = Effect.fn("checkoutStatus.getStatus")(
      function* (input: {
        readonly orderId: string;
        readonly returnOutcome: CheckoutStatusReturnOutcome;
      }) {
        const reservation = yield* reservations.findById(input.orderId);

        if (!reservation) {
          return {
            orderId: input.orderId,
            returnOutcome: input.returnOutcome,
            status: "not_found",
          } satisfies CheckoutStatusViewModel;
        }

        return {
          orderId: reservation.id,
          returnOutcome: input.returnOutcome,
          status: toCheckoutStatusKind(
            reservation.paymentState,
            reservation.fulfillmentState
          ),
          paymentStatus: reservation.paymentState,
          fulfillmentStatus: reservation.fulfillmentState,
        } satisfies CheckoutStatusViewModel;
      },
      (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
    );

    return CheckoutStatusService.of({
      getStatus,
      recordProviderReturn: Effect.fn("checkoutStatus.recordProviderReturn")(
        function* (input) {
          const reservation = yield* reservations.findById(input.orderId);

          if (!reservation?.activePaymentAttemptId) {
            return yield* getStatus(input);
          }

          const result = yield* finalization.finalizePendingProviderPayment({
            orderId: reservation.id,
            paymentAttemptId: reservation.activePaymentAttemptId,
          });

          if (result === "terminal") {
            yield* holdCleanup
              .cancelOrderHold({ orderId: reservation.id })
              .pipe(Effect.ignore);
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
    Layer.provide(ReservationHoldCleanupServiceLiveWithDependencies),
    Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies),
    Layer.provide(OperationalEventRepositoryLive),
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(
      Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
    ),
    Layer.provide(
      Layer.provide(
        NexiService.Default,
        Layer.provide(NexiApi.Default, NexiRuntimeConfigLive)
      )
    )
  );
