import { DotyposService } from "@deskohub/dotypos";
import { EmailServiceTag } from "@deskohub/email/backend/service";
import { Context, Data, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceCheckoutNetworkDetailsService } from "@/features/checkout/backend/fulfillment/network-details.service";
import { WorkspaceReservationEmailService } from "@/features/checkout/backend/fulfillment/workspace-reservation-email.service";
import { administrationForcedPaymentCancellationFailureCode } from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import {
  SeatingMapFeatureFlagService,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import {
  ADMINISTRATION_CANCELLATION_RETRY_AFTER_MS,
  canCancelReservation,
} from "./reservation-status";

export type ReservationCancellationResult = {
  readonly outcome: "cancelled" | "already_cancelled";
  readonly email: "not_requested" | "sent" | "failed";
};

export class ReservationAdministrationError extends Data.TaggedError(
  "ReservationAdministrationError"
)<{
  readonly code: "not_found" | "not_cancellable" | "cancellation_failed";
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface IReservationAdministrationService {
  readonly cancel: (input: {
    readonly accessGrantUpdatedAt: string | null;
    readonly force?: boolean;
    readonly providerCredentialRemoved: boolean;
    readonly reservationId: WorkspaceReservationId;
    readonly sendCancellationEmail: boolean;
  }) => Effect.Effect<
    ReservationCancellationResult,
    ReservationAdministrationError
  >;
}

export class ReservationAdministrationService extends Context.Service<
  ReservationAdministrationService,
  IReservationAdministrationService
>()("@deskohub-workspace/administration/ReservationAdministrationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const emails = yield* WorkspaceReservationEmailService;
      const reservations = yield* WorkspaceReservationRepository;
      const reservationDetails = yield* WorkspaceReservationService;

      return {
        cancel: Effect.fn("ReservationAdministrationService.cancel")(
          function* (input) {
            const current = yield* reservations
              .findById(input.reservationId)
              .pipe(
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "The reservation could not be loaded.",
                    cause
                  )
                )
              );
            if (!current) {
              return yield* new ReservationAdministrationError({
                code: "not_found",
                message: "The reservation was not found.",
              });
            }
            if (current.reservationState === "cancelled") {
              return {
                outcome: "already_cancelled",
                email: "not_requested",
              };
            }
            const forcedPendingPayment =
              current.paymentState === "pending" && input.force === true;
            const administrationForceCancellation =
              forcedPendingPayment ||
              current.failureCode ===
                administrationForcedPaymentCancellationFailureCode;
            if (
              !canCancelReservation(
                current,
                Temporal.Now.instant(),
                forcedPendingPayment
              )
            ) {
              return yield* new ReservationAdministrationError({
                code: "not_cancellable",
                message:
                  current.fulfillmentState === "processing"
                    ? "The reservation is being confirmed. Try again after confirmation finishes."
                    : "The reservation cannot be cancelled in its current state.",
              });
            }

            const details = yield* reservationDetails
              .getReservation(current.id)
              .pipe(
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "The current reservation details could not be loaded.",
                    cause
                  )
                )
              );
            if (
              details.providerStatus === "CANCELLED" &&
              !["cancelling", "cancellation_failed"].includes(
                current.reservationState
              )
            ) {
              return yield* new ReservationAdministrationError({
                code: "not_cancellable",
                message:
                  "Dotypos already reports this reservation as cancelled. Use the recovery workflow instead.",
              });
            }
            if (current.paymentState === "pending") {
              if (!forcedPendingPayment || !current.activePaymentAttemptId) {
                return yield* new ReservationAdministrationError({
                  code: "not_cancellable",
                  message:
                    "The reservation has a pending payment. Retry with force only after reviewing the provider payment.",
                });
              }
            }
            const pendingPaymentCancellation =
              forcedPendingPayment && current.activePaymentAttemptId
                ? {
                    paymentAttemptId: current.activePaymentAttemptId,
                    failureCode:
                      administrationForcedPaymentCancellationFailureCode,
                  }
                : undefined;
            const claimed = yield* reservations
              .claimAdministrationCancellation({
                accessGrantUpdatedAt: input.accessGrantUpdatedAt,
                id: current.id,
                ...(pendingPaymentCancellation && {
                  pendingPaymentCancellation,
                }),
                providerCredentialRemoved: input.providerCredentialRemoved,
                staleCancellingBefore: Temporal.Now.instant().subtract({
                  milliseconds: ADMINISTRATION_CANCELLATION_RETRY_AFTER_MS,
                }),
              })
              .pipe(
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "The reservation could not be claimed for cancellation.",
                    cause
                  )
                )
              );
            if (!claimed) {
              return yield* new ReservationAdministrationError({
                code: "not_cancellable",
                message:
                  "The reservation changed while cancellation was starting, or an active door PIN still needs removal. Refresh and try again.",
              });
            }

            if (details.providerStatus !== "CANCELLED") {
              yield* dotypos
                .cancelReservation(details.dotyposReservationId)
                .pipe(
                  Effect.catch((cause) =>
                    Effect.gen(function* () {
                      const cancelled = yield* reservationDetails
                        .getReservation(current.id)
                        .pipe(
                          Effect.map(
                            (latest) => latest.providerStatus === "CANCELLED"
                          ),
                          Effect.orElseSucceed(() => false)
                        );
                      if (cancelled) return;

                      yield* reservations
                        .markAdministrationCancellationFailed({
                          id: claimed.id,
                          claimedAt: claimed.updatedAt,
                          failureCode: administrationForceCancellation
                            ? administrationForcedPaymentCancellationFailureCode
                            : "admin_dotypos_cancel_failed",
                        })
                        .pipe(Effect.ignore);
                      return yield* Effect.fail(cause);
                    })
                  ),
                  Effect.mapError((cause) =>
                    cancellationFailed(
                      "Dotypos could not cancel the reservation.",
                      cause
                    )
                  )
                );
            }

            yield* reservations
              .markAdministrationCancelled({
                id: claimed.id,
                cancelledAt: Temporal.Now.instant(),
                claimedAt: claimed.updatedAt,
                failureCode: administrationForceCancellation
                  ? administrationForcedPaymentCancellationFailureCode
                  : null,
              })
              .pipe(
                Effect.tapError(() =>
                  reservations
                    .markAdministrationCancellationFailed({
                      id: claimed.id,
                      claimedAt: claimed.updatedAt,
                      failureCode: administrationForceCancellation
                        ? administrationForcedPaymentCancellationFailureCode
                        : "admin_local_cancel_failed",
                    })
                    .pipe(Effect.ignore)
                ),
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "The completed cancellation could not be recorded.",
                    cause
                  )
                )
              );

            return {
              outcome: "cancelled",
              email: yield* sendLoadedCancellationEmail({
                send: input.sendCancellationEmail,
                details,
                emails,
              }),
            };
          }
        ),
      } satisfies IReservationAdministrationService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.provideMerge(
        WorkspaceReservationEmailService.Default,
        Layer.provideMerge(
          Layer.provideMerge(EmailServiceTag.Live, EmailConfigLayer),
          WorkspaceCheckoutNetworkDetailsService.Default
        )
      )
    ),
    Layer.provide(WorkspaceReservationService.Default),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(
      SeatingMapFeatureFlagService.Default.pipe(
        Layer.provide(WorkspaceFeatureFlagService.Default)
      )
    )
  );
}

type IWorkspaceReservationEmailService =
  WorkspaceReservationEmailService["Service"];

const sendLoadedCancellationEmail = ({
  details,
  emails,
  send,
}: {
  readonly details: Parameters<
    IWorkspaceReservationEmailService["sendCancellationEmail"]
  >[0]["reservation"];
  readonly emails: IWorkspaceReservationEmailService;
  readonly send: boolean;
}) =>
  emails.sendCancellationEmail({ reservation: details }).pipe(
    Effect.as("sent" as const),
    Effect.orElseSucceed(() => "failed" as const),
    Effect.when(Effect.succeed(send)),
    Effect.map(Option.getOrElse(() => "not_requested" as const))
  );

const cancellationFailed = (message: string, cause: unknown) =>
  new ReservationAdministrationError({
    code: "cancellation_failed",
    message,
    cause,
  });
