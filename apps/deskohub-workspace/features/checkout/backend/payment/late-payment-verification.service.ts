import "@/shared/polyfills/temporal";

import {
  getNexiPaymentMetadata,
  NexiCurrencySchema,
  NexiService,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import { Context, type Duration, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { LatePaymentRecovery } from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import {
  type PaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import { LatePaymentRecoveryQueueService } from "./late-payment-recovery-queue.service";
import { getNexiCurrencyOverride } from "./nexi-currency";
import {
  isVerifiableNexiPaymentAttempt,
  type VerifiableNexiPaymentAttempt,
} from "./verifiable-nexi-payment-attempt";

type LatePaymentVerificationResult =
  | "not_applicable"
  | "not_verifiable"
  | "not_settled"
  | "provider_verification_failed"
  | "recovery_started"
  | "verification_mismatch";

/**
 * A pending recovery this old without progress may have lost its queue
 * message, so verification sends it again; the queue deduplicates by attempt.
 */
const stalledRecoveryEnqueueAfter = Temporal.Duration.from({ minutes: 1 });

const isTerminalPaymentState = (state: string) =>
  state === "failed" || state === "cancelled" || state === "expired";

const isStalledPendingRecovery = (
  recovery: Pick<LatePaymentRecovery, "state" | "createdAt">
) =>
  recovery.state === "pending" &&
  Temporal.Instant.compare(
    recovery.createdAt,
    Temporal.Now.instant().subtract(stalledRecoveryEnqueueAfter)
  ) < 0;

/** A terminal Nexi attempt Nexi can verify with its stored security token. */
const isVerifiableTerminalAttempt = (
  attempt: PaymentAttempt | null
): attempt is VerifiableNexiPaymentAttempt =>
  isVerifiableNexiPaymentAttempt(attempt) &&
  isTerminalPaymentState(attempt.state);

export interface ILatePaymentVerificationService {
  /**
   * Verifies the reservation's terminal Nexi attempt and starts durable
   * late-payment recovery when Nexi settled it after the local attempt ended.
   * Provider and database failures are logged and reported as a result so the
   * customer status page still renders the stored status.
   */
  readonly startRecoveryIfSettled: (input: {
    readonly orderId: WorkspaceReservationId;
    /** Bounds the Nexi payment verification, retries included. */
    readonly verificationDeadline?: Duration.Input;
  }) => Effect.Effect<LatePaymentVerificationResult>;
}

export class LatePaymentVerificationService extends Context.Service<
  LatePaymentVerificationService,
  ILatePaymentVerificationService
>()("@deskohub-workspace/checkout/LatePaymentVerificationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const paymentAttempts = yield* PaymentAttemptRepository;
      const recoveries = yield* LatePaymentRecoveryRepository;
      const recoveryQueue = yield* LatePaymentRecoveryQueueService;
      const nexi = yield* NexiService;

      const resumeExistingRecovery = Effect.fnUntraced(function* (
        existing: Pick<LatePaymentRecovery, "state" | "createdAt">,
        paymentAttemptId: PaymentAttemptId
      ) {
        if (isStalledPendingRecovery(existing)) {
          yield* recoveryQueue.enqueue({ paymentAttemptId });
        }
        return "recovery_started" as const;
      });

      /** Nexi's verification of the attempt, or undefined when it failed. */
      const verifyAttemptOutcome = Effect.fnUntraced(function* (
        attempt: VerifiableNexiPaymentAttempt,
        correlationId: WorkspaceReservation["correlationId"],
        verificationDeadline: Duration.Input | undefined
      ) {
        const currency = yield* Schema.decodeUnknownEffect(NexiCurrencySchema)(
          attempt.amount.currency
        );

        return yield* nexi
          .verifyPaymentOutcome({
            orderId: attempt.providerOrderId,
            correlationId,
            amount: String(attempt.amount.value),
            currency: getNexiCurrencyOverride() ?? currency,
            securityToken: attempt.securityToken,
            deadline: verificationDeadline,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logWarning(
                "Late-payment verification provider lookup failed",
                { cause }
              )
            ),
            Effect.orElseSucceed(() => undefined)
          );
      });

      const startRecoveryFromVerification = Effect.fnUntraced(function* (
        paymentAttemptId: PaymentAttemptId,
        workspaceReservationId: WorkspaceReservationId,
        verification: PaymentVerificationResult | undefined
      ) {
        if (!verification) return "provider_verification_failed" as const;
        if (verification.mismatches.length > 0) {
          yield* Effect.logWarning(
            "Late-payment verification provider facts mismatch",
            { mismatches: verification.mismatches }
          );
          return "verification_mismatch" as const;
        }
        if (verification.status !== "success") {
          return "not_settled" as const;
        }

        yield* Effect.logWarning(
          "Nexi payment settled after the local payment attempt became terminal"
        );
        const { providerOperationId, providerStatus } =
          getNexiPaymentMetadata(verification);
        yield* recoveries.start({
          paymentAttemptId,
          workspaceReservationId,
          providerOperationId,
          providerStatus,
          verifiedPaidAt: Temporal.Now.instant(),
        });
        yield* recoveryQueue.enqueue({ paymentAttemptId });
        return "recovery_started" as const;
      });

      const startRecoveryIfSettled = Effect.fn(
        "latePaymentVerification.startRecoveryIfSettled"
      )(
        function* (
          input: Parameters<
            ILatePaymentVerificationService["startRecoveryIfSettled"]
          >[0]
        ) {
          const reservation = yield* reservations.findById(input.orderId);
          const paymentAttemptId = reservation?.activePaymentAttemptId;
          if (
            !(reservation && paymentAttemptId) ||
            !isTerminalPaymentState(reservation.paymentState)
          ) {
            return "not_applicable" as const;
          }

          const existing =
            yield* recoveries.findByPaymentAttemptId(paymentAttemptId);
          if (existing) {
            return yield* resumeExistingRecovery(existing, paymentAttemptId);
          }

          const attempt = yield* paymentAttempts.findById(paymentAttemptId);
          if (!isVerifiableTerminalAttempt(attempt)) {
            return "not_verifiable" as const;
          }

          const verification = yield* verifyAttemptOutcome(
            attempt,
            reservation.correlationId,
            input.verificationDeadline
          );
          return yield* startRecoveryFromVerification(
            paymentAttemptId,
            reservation.id,
            verification
          );
        },
        (effect, input) =>
          effect.pipe(
            Effect.tapError((cause) =>
              Effect.logError("Late-payment verification failed", { cause })
            ),
            Effect.orElseSucceed(() => "not_verifiable" as const),
            Effect.annotateLogs({ orderId: input.orderId })
          )
      );

      return LatePaymentVerificationService.of({ startRecoveryIfSettled });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceReservationRepository.Default,
        PaymentAttemptRepository.Default,
        LatePaymentRecoveryRepository.Default,
        LatePaymentRecoveryQueueService.Live,
        WorkspaceNexiLayer
      )
    ),
    Layer.provide(WorkspaceDatabase.Default)
  );
}
