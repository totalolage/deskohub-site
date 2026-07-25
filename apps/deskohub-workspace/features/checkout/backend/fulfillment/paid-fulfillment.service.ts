import { DotyposService } from "@deskohub/dotypos";
import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Context, Data, Effect, Layer, Predicate } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { SeatingMapFeatureFlagService } from "@/features/feature-flags/backend";
import { WorkspaceFeatureFlagServiceLive } from "@/features/feature-flags/backend/workspace-feature-flag.server";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
  type WorkspaceReservationStateError,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import {
  PostHogEventService,
  PostHogEventServiceLive,
} from "@/shared/backend/analytics/posthog-event.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { serializeErrorForLog } from "@/shared/utils/error-formatting";
import { captureReservationCompleted } from "../analytics/posthog-lifecycle-events";
import { WorkspaceCheckoutNetworkDetailsService } from "./network-details.service";
import {
  WorkspaceReservationEmailService,
  WorkspaceReservationEmailServiceLive,
} from "./workspace-reservation-email.service";

export type WorkspacePaidFulfillmentFailureCode =
  | "dotypos_reservation_failed"
  | "dotypos_reservation_unfulfillable"
  | "fulfillment_email_failed"
  | "fulfillment_order_load_failed"
  | "fulfillment_claim_failed"
  | "fulfillment_completion_failed";

export class WorkspacePaidFulfillmentError extends Data.TaggedError(
  "WorkspacePaidFulfillmentError"
)<{
  readonly orderId: string;
  readonly failureCode: WorkspacePaidFulfillmentFailureCode;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS = 15 * 60 * 1000;

export interface WorkspacePaidFulfillmentService {
  readonly fulfillPaidOrder: (input: {
    readonly orderId: string;
  }) => Effect.Effect<
    "busy" | "delivery_dispatched" | "fulfilled" | "ignored",
    WorkspacePaidFulfillmentError | WorkspaceReservationStateError
  >;
}

export const WorkspacePaidFulfillmentService =
  Context.Service<WorkspacePaidFulfillmentService>(
    "WorkspacePaidFulfillmentService"
  );

export const WorkspacePaidFulfillmentServiceLive = Layer.effect(
  WorkspacePaidFulfillmentService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const dotypos = yield* DotyposService;
    const reservationEmails = yield* WorkspaceReservationEmailService;
    const workspaceReservations = yield* WorkspaceReservationService;
    const posthogEvents = yield* PostHogEventService;

    const failFulfillment = Effect.fn("workspacePaidFulfillment.fail")(
      function* (input: {
        readonly orderId: string;
        readonly failureCode: WorkspacePaidFulfillmentFailureCode;
        readonly cause?: unknown;
      }) {
        yield* Effect.logInfo("Paid fulfillment failure handling started");

        yield* Effect.logInfo("Paid fulfillment failure marker started");
        yield* reservations
          .markFulfillmentFailed({
            id: input.orderId,
            failureCode: input.failureCode,
            failedAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.tapError(() =>
              Effect.logError("Paid fulfillment failure marker failed", {
                orderId: input.orderId,
                failureCode: input.failureCode,
              })
            ),
            Effect.ignore
          );
        yield* Effect.logInfo("Paid fulfillment failure marker completed");
        yield* Effect.logFatal("Paid fulfillment failure handling completed");

        return yield* new WorkspacePaidFulfillmentError({
          orderId: input.orderId,
          failureCode: input.failureCode,
          message: "Paid reservation fulfillment failed.",
          cause:
            input.cause === undefined
              ? undefined
              : serializeErrorForLog(input.cause),
        });
      }
    );

    return WorkspacePaidFulfillmentService.of({
      fulfillPaidOrder: Effect.fn("workspacePaidFulfillment.fulfillPaidOrder")(
        function* (input) {
          yield* Effect.logInfo("Paid fulfillment started");

          yield* Effect.logDebug("Paid fulfillment reservation lookup started");
          const reservation = yield* reservations.findById(input.orderId).pipe(
            Effect.mapError(
              (cause) =>
                new WorkspacePaidFulfillmentError({
                  orderId: input.orderId,
                  failureCode: "fulfillment_order_load_failed",
                  message:
                    "Paid reservation could not be loaded for fulfillment.",
                  cause: serializeErrorForLog(cause),
                })
            )
          );
          yield* Effect.logDebug("Paid fulfillment reservation loaded");

          if (!reservation) {
            yield* Effect.logWarning(
              "Paid fulfillment skipped: reservation missing",
              {
                reason: "reservation_missing",
              }
            );
            return "ignored" as const;
          }

          if (reservation.paymentState !== "paid") {
            yield* Effect.logWarning(
              "Paid fulfillment skipped: reservation not paid",
              {
                reason: "reservation_not_paid",
              }
            );
            return "ignored" as const;
          }

          if (reservation.fulfillmentState === "fulfilled") {
            yield* Effect.logInfo(
              "Paid fulfillment skipped: already fulfilled",
              {
                reason: "already_fulfilled",
              }
            );
            return "fulfilled" as const;
          }

          const staleProcessingBefore = Temporal.Now.instant().subtract({
            milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS,
          });

          if (reservation.fulfillmentState === "processing") {
            if (
              Temporal.Instant.compare(
                reservation.updatedAt,
                staleProcessingBefore
              ) > 0
            ) {
              yield* Effect.logInfo(
                "Paid fulfillment skipped: already processing",
                {
                  reason: "already_processing",
                }
              );
              return "busy" as const;
            }

            yield* Effect.logWarning(
              "Paid fulfillment retrying stale processing reservation",
              {
                reason: "stale_processing",
                staleProcessingBefore,
              }
            );
          }

          const claimed = yield* reservations
            .claimPaidFulfillment({
              id: reservation.id,
              staleProcessingBefore,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new WorkspacePaidFulfillmentError({
                    orderId: input.orderId,
                    failureCode: "fulfillment_claim_failed",
                    message:
                      "Paid reservation could not be claimed for fulfillment.",
                    cause: serializeErrorForLog(cause),
                  })
              )
            );
          yield* Effect.logDebug("Paid fulfillment claim completed");

          if (!claimed) {
            yield* Effect.logWarning(
              "Paid fulfillment skipped: claim returned no reservation",
              { reason: "claim_returned_no_reservation" }
            );
            return "busy" as const;
          }
          yield* Effect.logInfo("Paid fulfillment claim succeeded");

          if (!claimed.dotyposReservationId) {
            yield* Effect.logWarning(
              "Paid fulfillment failed: missing Dotypos reservation hold",
              { reason: "missing_dotypos_reservation_id" }
            );

            return yield* failFulfillment({
              orderId: input.orderId,
              failureCode: "dotypos_reservation_unfulfillable",
            });
          }

          if (
            claimed.reservationState !== "held" &&
            claimed.reservationState !== "confirmed"
          ) {
            yield* Effect.logWarning(
              "Paid fulfillment failed: reservation no longer confirmable",
              { reason: "reservation_no_longer_confirmable" }
            );

            return yield* failFulfillment({
              orderId: input.orderId,
              failureCode: "dotypos_reservation_unfulfillable",
            });
          }

          yield* Effect.logInfo(
            "Dotypos paid reservation reconciliation started"
          );
          const liveStatus = yield* dotypos
            .getReservationStatus(claimed.dotyposReservationId)
            .pipe(
              Effect.catch((cause) =>
                failFulfillment({
                  orderId: input.orderId,
                  failureCode: "dotypos_reservation_failed",
                  cause,
                })
              )
            );

          if (liveStatus === "CANCELLED") {
            yield* Effect.logWarning(
              "Paid fulfillment retained for manual recovery",
              { reason: "dotypos_reservation_cancelled" }
            );
            return yield* failFulfillment({
              orderId: input.orderId,
              failureCode: "dotypos_reservation_unfulfillable",
            });
          }

          if (liveStatus === "NEW") {
            yield* Effect.logInfo(
              "Dotypos paid reservation confirmation started"
            );
            const confirmed = yield* dotypos
              .confirmReservation(claimed.dotyposReservationId)
              .pipe(
                Effect.catch((cause) =>
                  failFulfillment({
                    orderId: input.orderId,
                    failureCode: "dotypos_reservation_failed",
                    cause,
                  })
                )
              );
            if (confirmed.status !== "CONFIRMED") {
              return yield* failFulfillment({
                orderId: input.orderId,
                failureCode: "dotypos_reservation_unfulfillable",
              });
            }
            yield* Effect.logInfo(
              "Dotypos paid reservation confirmation succeeded"
            );
          }
          yield* Effect.logInfo(
            "Dotypos paid reservation reconciliation completed"
          );

          if (claimed.reservationState === "held") {
            yield* Effect.logInfo(
              "Paid fulfillment reservation confirmed marker started"
            );
            const confirmedAt = Temporal.Now.instant();
            yield* reservations
              .markReservationConfirmed({
                id: claimed.id,
                confirmedAt,
              })
              .pipe(
                Effect.tapError(() =>
                  Effect.logError(
                    "Paid fulfillment reservation confirmed marker failed",
                    { orderId: claimed.id }
                  )
                )
              );
            yield* Effect.logInfo(
              "Paid fulfillment reservation confirmed marker succeeded"
            );
            yield* captureReservationCompleted({
              reservation: claimed,
              timestamp: confirmedAt,
            }).pipe(Effect.provideService(PostHogEventService, posthogEvents));
          }

          yield* Effect.logInfo("Paid reservation email flow started");
          yield* workspaceReservations.getReservation(claimed.id).pipe(
            Effect.flatMap((reservation) =>
              reservationEmails.sendPaidReservationEmails({ reservation })
            ),
            Effect.tapError(() =>
              Effect.logError("Workspace paid reservation email flow failed", {
                workspaceReservationId: claimed.id,
                dotyposCustomerId: claimed.dotyposCustomerId,
              })
            ),
            Effect.catch((cause) =>
              failFulfillment({
                orderId: input.orderId,
                failureCode: "fulfillment_email_failed",
                cause,
              })
            )
          );
          yield* Effect.logInfo("Paid reservation email flow succeeded");
          yield* Effect.logInfo(
            "Paid fulfillment is awaiting Resend delivery webhook"
          );
          return "delivery_dispatched" as const;
        },
        (effect, input) =>
          effect.pipe(
            Effect.scoped,
            Effect.mapError((cause) =>
              Predicate.isTagged(cause, "WorkspacePaidFulfillmentError") ||
              Predicate.isTagged(cause, "WorkspaceReservationStateError")
                ? cause
                : new WorkspacePaidFulfillmentError({
                    orderId: input.orderId,
                    failureCode: "fulfillment_completion_failed",
                    message: "Paid reservation fulfillment failed.",
                    cause: serializeErrorForLog(cause),
                  })
            ),
            Effect.annotateLogs({ ...input })
          )
      ),
    });
  })
);

export const WorkspacePaidFulfillmentServiceLiveWithDependencies =
  WorkspacePaidFulfillmentServiceLive.pipe(
    Layer.provide(
      Layer.provideMerge(
        WorkspaceReservationEmailServiceLive,
        Layer.provideMerge(
          Layer.provideMerge(StandaloneEmailServiceLayer, EmailConfigLayer),
          WorkspaceCheckoutNetworkDetailsService.Live
        )
      )
    ),
    Layer.provide(PostHogEventServiceLive),
    Layer.provide(WorkspaceReservationService.Live),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(DotyposServiceLive),
    Layer.provide(
      SeatingMapFeatureFlagService.Live.pipe(
        Layer.provide(WorkspaceFeatureFlagServiceLive)
      )
    )
  );
