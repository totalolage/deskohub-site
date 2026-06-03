import { DotyposService } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import {
  type DatabaseError,
  WorkspaceDatabaseLive,
} from "@/db/database.service";
import type {
  FulfillmentState,
  PaymentAttempt,
  PaymentState,
  WorkspaceReservation,
} from "@/db/schema";
import { OperationalEventRepositoryLive } from "@/features/checkout/backend/operational-event.repository";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "@/features/checkout/backend/payment-attempt.repository";
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
import {
  isWorkspaceProductMonitorOption,
  isWorkspaceProductTier,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { NexiServiceLive } from "@/shared/backend/config/nexi.config";

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

export type WorkspaceCheckoutStatusSummary = {
  readonly tier: WorkspaceProductTier;
  readonly date: string;
  readonly coffee: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
  readonly price: WorkspaceMoney;
};

export type CheckoutStatusViewModel = {
  readonly orderId: string;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
  readonly status: CheckoutStatusKind;
  readonly paymentStatus?: PaymentState;
  readonly fulfillmentStatus?: FulfillmentState;
  readonly summary?: WorkspaceCheckoutStatusSummary;
};

export interface CheckoutStatusService {
  readonly getStatus: (input: {
    readonly orderId: string;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) => Effect.Effect<CheckoutStatusViewModel, DatabaseError>;
  readonly refreshStatus: (input: {
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

const toPragueReservationDate = (startDate: string | number) => {
  const date =
    typeof startDate === "number" || /^\d+$/.test(startDate)
      ? new Date(Number(startDate))
      : new Date(startDate);

  if (Number.isNaN(date.getTime())) return undefined;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");

  return year && month && day ? `${year}-${month}-${day}` : undefined;
};

const canUseAttemptForSummary = (
  attempt: PaymentAttempt,
  reservation: WorkspaceReservation
) => {
  if (
    attempt.id === reservation.activePaymentAttemptId &&
    ["created", "pending", "paid"].includes(attempt.state)
  ) {
    return true;
  }

  return reservation.paymentState === "paid" && attempt.state === "paid";
};

export const CheckoutStatusServiceLive = Layer.effect(
  CheckoutStatusService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
    const dotypos = yield* DotyposService;
    const holdCleanup = yield* ReservationHoldCleanupService;
    const finalization = yield* ProviderPaymentFinalizationService;

    const reconstructSummary = Effect.fn("checkoutStatus.reconstructSummary")(
      function* (reservation: WorkspaceReservation) {
        const monitorOption = reservation.productMonitorOption ?? undefined;

        if (
          !reservation.dotyposReservationId ||
          !isWorkspaceProductTier(reservation.productTier) ||
          (monitorOption !== undefined &&
            !isWorkspaceProductMonitorOption(monitorOption))
        ) {
          return undefined;
        }

        const attempt = yield* paymentAttempts.findDisplayableForReservation({
          workspaceReservationId: reservation.id,
          activePaymentAttemptId:
            reservation.activePaymentAttemptId ?? undefined,
          paymentState: reservation.paymentState,
        });

        if (!attempt || !canUseAttemptForSummary(attempt, reservation)) {
          return undefined;
        }

        const dotyposReservation = yield* dotypos
          .getReservation(reservation.dotyposReservationId)
          .pipe(
            Effect.tapError((cause) =>
              Effect.logWarning(
                "Checkout status summary reservation load failed",
                {
                  reservationId: reservation.id,
                  dotyposReservationId: reservation.dotyposReservationId,
                  cause,
                }
              )
            ),
            Effect.option
          );

        if (dotyposReservation._tag === "None") return undefined;

        const date = toPragueReservationDate(
          dotyposReservation.value.reservation.startDate
        );

        if (!date) return undefined;

        return {
          tier: reservation.productTier,
          date,
          coffee: reservation.productCoffee,
          monitorOption,
          price: {
            value: attempt.amountValue,
            exponent: attempt.amountExponent,
            currency: attempt.currency,
          },
        } satisfies WorkspaceCheckoutStatusSummary;
      },
      (effect, reservation) =>
        effect.pipe(Effect.annotateLogs({ reservationId: reservation.id }))
    );

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

        const summary = yield* reconstructSummary(reservation);

        return {
          orderId: reservation.id,
          returnOutcome: input.returnOutcome,
          status: toCheckoutStatusKind(
            reservation.paymentState,
            reservation.fulfillmentState
          ),
          paymentStatus: reservation.paymentState,
          fulfillmentStatus: reservation.fulfillmentState,
          ...(summary ? { summary } : {}),
        } satisfies CheckoutStatusViewModel;
      },
      (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
    );

    return CheckoutStatusService.of({
      getStatus,
      refreshStatus: Effect.fn("checkoutStatus.refreshStatus")(
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
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning(
                    "Checkout status terminal hold cleanup failed",
                    {
                      orderId: reservation.id,
                      cause,
                    }
                  )
                ),
                Effect.ignore
              );
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
    Layer.provide(NexiServiceLive)
  );
