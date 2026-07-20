import { DotyposService } from "@deskohub/dotypos";
import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Context, Data, Effect, Layer, Predicate } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { SeatingMapFeatureFlagService } from "@/features/feature-flags/backend";
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
    void,
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
        yield* Effect.annotateLogsScoped({ input });
        yield* Effect.logInfo("Paid fulfillment failure handling started");

        yield* Effect.logInfo("Paid fulfillment failure marker started");
        yield* reservations
          .markFulfillmentFailed({
            id: input.orderId,
            failureCode: input.failureCode,
            failedAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logError("Paid fulfillment failure marker failed", {
                orderId: input.orderId,
                failureCode: input.failureCode,
                cause,
              })
            ),
            Effect.ignore
          );
        yield* Effect.logInfo("Paid fulfillment failure marker completed");
        yield* Effect.logFatal("Paid fulfillment failure handling completed");

        return yield* Effect.fail(
          new WorkspacePaidFulfillmentError({
            ...input,
            message: "Paid reservation fulfillment failed.",
          })
        );
      }
    );

    return WorkspacePaidFulfillmentService.of({
      fulfillPaidOrder: Effect.fn("workspacePaidFulfillment.fulfillPaidOrder")(
        function* (input) {
          yield* Effect.annotateLogsScoped({ input });
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
                  cause,
                })
            )
          );
          yield* Effect.annotateLogsScoped({ reservation });
          yield* Effect.logDebug("Paid fulfillment reservation loaded");

          if (!reservation) {
            yield* Effect.logWarning(
              "Paid fulfillment skipped: reservation missing",
              {
                reason: "reservation_missing",
              }
            );
            return;
          }

          if (reservation.paymentState !== "paid") {
            yield* Effect.logWarning(
              "Paid fulfillment skipped: reservation not paid",
              {
                reason: "reservation_not_paid",
              }
            );
            return;
          }

          if (reservation.fulfillmentState === "fulfilled") {
            yield* Effect.logInfo(
              "Paid fulfillment skipped: already fulfilled",
              {
                reason: "already_fulfilled",
              }
            );
            return;
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
              return;
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
                    cause,
                  })
              )
            );
          yield* Effect.annotateLogsScoped({ claimed });
          yield* Effect.logDebug("Paid fulfillment claim completed");

          if (!claimed) {
            yield* Effect.logWarning(
              "Paid fulfillment skipped: claim returned no reservation",
              { reason: "claim_returned_no_reservation" }
            );
            return;
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

          if (claimed.reservationState !== "confirmed") {
            if (claimed.reservationState !== "held") {
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
              "Dotypos paid reservation confirmation started"
            );
            yield* dotypos
              .confirmReservation(claimed.dotyposReservationId)
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logError(
                    "Dotypos paid reservation confirmation failed",
                    { claimed, cause }
                  )
                ),
                Effect.catch((cause) =>
                  failFulfillment({
                    orderId: input.orderId,
                    failureCode: "dotypos_reservation_failed",
                    cause,
                  })
                )
              );
            yield* Effect.logInfo(
              "Dotypos paid reservation confirmation succeeded"
            );

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
                Effect.tapError((cause) =>
                  Effect.logError(
                    "Paid fulfillment reservation confirmed marker failed",
                    { claimed, cause }
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
            Effect.tapError((cause) =>
              Effect.logError("Workspace paid reservation email flow failed", {
                workspaceReservationId: claimed.id,
                dotyposCustomerId: claimed.dotyposCustomerId,
                cause,
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
                    cause,
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
        Layer.mergeAll(
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
    Layer.provide(SeatingMapFeatureFlagService.Live)
  );
