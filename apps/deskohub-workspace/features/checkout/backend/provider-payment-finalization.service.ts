import { DotyposService } from "@deskohub/dotypos";
import {
  classifyNexiFailureStatus,
  getNexiPaymentMetadata,
  NexiApi,
  NexiCurrencySchema,
  NexiService,
} from "@deskohub/nexi";
import { Context, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  WorkspacePaidFulfillmentService,
  WorkspacePaidFulfillmentServiceLiveWithDependencies,
} from "@/features/checkout/backend/paid-fulfillment.service";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "@/features/checkout/backend/payment-attempt.repository";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/checkout/backend/workspace-reservation.repository";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { NexiRuntimeConfigLive } from "@/shared/backend/config/nexi.config";

export type ProviderPaymentFinalizationResult =
  | "not_found"
  | "not_pending"
  | "not_verifiable"
  | "verification_mismatch"
  | "pending"
  | "paid"
  | "terminal";

export interface ProviderPaymentFinalizationService {
  readonly finalizePendingProviderPayment: (input: {
    readonly orderId: string;
    readonly paymentAttemptId?: string;
    readonly webhookEventId?: string;
  }) => Effect.Effect<ProviderPaymentFinalizationResult, never>;
}

export const ProviderPaymentFinalizationService =
  Context.GenericTag<ProviderPaymentFinalizationService>(
    "ProviderPaymentFinalizationService"
  );

export const ProviderPaymentFinalizationServiceLive = Layer.effect(
  ProviderPaymentFinalizationService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
    const nexi = yield* NexiService;
    const fulfillment = yield* WorkspacePaidFulfillmentService;

    return ProviderPaymentFinalizationService.of({
      finalizePendingProviderPayment: Effect.fn(
        "providerPaymentFinalization.finalizePendingProviderPayment"
      )(function* (input) {
        const reservation = yield* reservations
          .findById(input.orderId)
          .pipe(Effect.orElseSucceed(() => null));
        const paymentAttemptId =
          input.paymentAttemptId ?? reservation?.activePaymentAttemptId;

        if (!reservation || !paymentAttemptId) return "not_found";
        if (reservation.paymentState !== "pending") {
          if (
            reservation.paymentState === "paid" &&
            reservation.fulfillmentState !== "fulfilled"
          ) {
            yield* fulfillment
              .fulfillPaidOrder({ orderId: reservation.id })
              .pipe(Effect.ignore);
            return "paid";
          }

          return "not_pending";
        }

        const attempt = yield* paymentAttempts
          .findById(paymentAttemptId)
          .pipe(Effect.orElseSucceed(() => null));
        if (!attempt?.securityToken) return "not_verifiable";

        const currency = yield* Schema.decodeUnknown(NexiCurrencySchema)(
          attempt.currency
        ).pipe(Effect.orDie);
        const verification = yield* nexi
          .verifyPaymentOutcome({
            orderId: attempt.providerOrderId,
            correlationId: reservation.correlationId,
            amount: String(attempt.amountValue),
            currency,
            securityToken: attempt.securityToken,
          })
          .pipe(Effect.orElseSucceed(() => undefined));

        if (!verification) return "not_verifiable";
        if (verification.mismatches.length > 0) return "verification_mismatch";

        const { providerOperationId, providerStatus } =
          getNexiPaymentMetadata(verification);

        if (verification.status === "success") {
          const paid = yield* paymentAttempts
            .markPaidForReservation({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              webhookEventId: input.webhookEventId,
              providerOperationId,
              providerStatus,
              paidAt: new Date(),
            })
            .pipe(Effect.either);

          if (paid._tag === "Left") return "not_pending";

          yield* fulfillment
            .fulfillPaidOrder({ orderId: reservation.id })
            .pipe(Effect.ignore);
          return "paid";
        }

        if (verification.status === "failure") {
          const failureKind = classifyNexiFailureStatus(providerStatus);
          const terminalState =
            failureKind === "cancelled"
              ? "cancelled"
              : failureKind === "expired"
                ? "expired"
                : "failed";

          const terminal = yield* paymentAttempts
            .markTerminalForReservation({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              state: terminalState,
              failureCode: "nexi_payment_failed",
              webhookEventId: input.webhookEventId,
              providerOperationId,
              providerStatus,
            })
            .pipe(Effect.either);

          return terminal._tag === "Right" ? "terminal" : "not_pending";
        }

        return "pending";
      }),
    });
  })
);

export const ProviderPaymentFinalizationServiceLiveWithDependencies =
  ProviderPaymentFinalizationServiceLive.pipe(
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(
      Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
    ),
    Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies),
    Layer.provide(
      Layer.provide(
        NexiService.Default,
        Layer.provide(NexiApi.Default, NexiRuntimeConfigLive)
      )
    )
  );
