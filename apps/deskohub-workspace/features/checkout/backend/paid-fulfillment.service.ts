import { DotyposService } from "@deskohub/dotypos";
import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  OperationalEventRepository,
  OperationalEventRepositoryLive,
} from "@/features/checkout/backend/operational-event.repository";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
  WorkspaceReservationStateError,
} from "@/features/checkout/backend/workspace-reservation.repository";
import {
  WorkspaceReservationEmailService,
  WorkspaceReservationEmailServiceLive,
} from "@/features/checkout/backend/workspace-reservation-email.service";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";

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

export interface WorkspacePaidFulfillmentService {
  readonly fulfillPaidOrder: (input: {
    readonly orderId: string;
  }) => Effect.Effect<
    void,
    WorkspacePaidFulfillmentError | WorkspaceReservationStateError
  >;
}

export const WorkspacePaidFulfillmentService =
  Context.GenericTag<WorkspacePaidFulfillmentService>(
    "WorkspacePaidFulfillmentService"
  );

export const WorkspacePaidFulfillmentServiceLive = Layer.effect(
  WorkspacePaidFulfillmentService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const operationalEvents = yield* OperationalEventRepository;
    const dotypos = yield* DotyposService;
    const reservationEmails = yield* WorkspaceReservationEmailService;

    const failFulfillment = Effect.fn("workspacePaidFulfillment.fail")(
      function* (input: {
        readonly orderId: string;
        readonly failureCode: WorkspacePaidFulfillmentFailureCode;
        readonly eventType:
          | "workspace_paid_fulfillment_missing_hold"
          | "workspace_paid_fulfillment_no_longer_confirmable"
          | "workspace_paid_fulfillment_confirm_failed"
          | "workspace_paid_fulfillment_email_failed"
          | "workspace_paid_fulfillment_mark_fulfilled_failed";
        readonly cause?: unknown;
      }) {
        yield* Effect.annotateLogsScoped({ input });
        yield* Effect.logInfo("Paid fulfillment failure handling started");

        yield* Effect.logInfo("Paid fulfillment failure marker started");
        yield* reservations
          .markFulfillmentFailed({
            id: input.orderId,
            failureCode: input.failureCode,
            failedAt: new Date(),
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

        yield* Effect.logInfo(
          "Paid fulfillment failure event recording started"
        );
        yield* operationalEvents
          .record({
            workspaceReservationId: input.orderId,
            eventType: input.eventType,
            severity: "error",
            failureCode: input.failureCode,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logError(
                "Paid fulfillment failure event recording failed",
                {
                  input,
                  cause,
                }
              )
            ),
            Effect.ignore
          );
        yield* Effect.logInfo("Paid fulfillment failure event recorded");
        yield* Effect.logInfo("Paid fulfillment failure handling completed");

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
            yield* Effect.logWarning(
              "Paid fulfillment skipped: already fulfilled",
              {
                reason: "already_fulfilled",
              }
            );
            return;
          }

          if (reservation.fulfillmentState === "processing") {
            yield* Effect.logWarning(
              "Paid fulfillment skipped: already processing",
              {
                reason: "already_processing",
              }
            );
            return;
          }

          const claimed = yield* reservations
            .claimPaidFulfillment(reservation.id)
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
              eventType: "workspace_paid_fulfillment_missing_hold",
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
                eventType: "workspace_paid_fulfillment_no_longer_confirmable",
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
                Effect.catchAll((cause) =>
                  failFulfillment({
                    orderId: input.orderId,
                    failureCode: "dotypos_reservation_failed",
                    eventType: "workspace_paid_fulfillment_confirm_failed",
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
            yield* reservations
              .markReservationConfirmed({
                id: claimed.id,
                confirmedAt: new Date(),
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
          }

          yield* Effect.logInfo("Paid reservation email flow started");
          yield* dotypos.getCustomer(claimed.dotyposCustomerId).pipe(
            Effect.flatMap((customer) =>
              reservationEmails.sendPaidReservationEmails({
                reservation: claimed,
                customer,
              })
            ),
            Effect.tapError((cause) =>
              Effect.logError("Workspace paid reservation email flow failed", {
                workspaceReservationId: claimed.id,
                dotyposCustomerId: claimed.dotyposCustomerId,
                cause,
              })
            ),
            Effect.catchAll((cause) =>
              failFulfillment({
                orderId: input.orderId,
                failureCode: "fulfillment_email_failed",
                eventType: "workspace_paid_fulfillment_email_failed",
                cause,
              })
            )
          );
          yield* Effect.logInfo("Paid reservation email flow succeeded");

          yield* Effect.logInfo("Paid fulfillment marker started");
          yield* reservations
            .markFulfilled({
              id: claimed.id,
              fulfilledAt: new Date(),
            })
            .pipe(
              Effect.tapError((cause) =>
                Effect.logError("Paid fulfillment marker failed", {
                  claimed,
                  cause,
                })
              ),
              Effect.catchAll((cause) =>
                failFulfillment({
                  orderId: input.orderId,
                  failureCode: "fulfillment_completion_failed",
                  eventType: "workspace_paid_fulfillment_mark_fulfilled_failed",
                  cause,
                })
              )
            );
          yield* Effect.logInfo("Paid fulfillment marker succeeded");
        },
        (effect, input) =>
          effect.pipe(
            Effect.scoped,
            Effect.mapError((cause) =>
              cause instanceof WorkspacePaidFulfillmentError ||
              cause instanceof WorkspaceReservationStateError
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
        Layer.provideMerge(StandaloneEmailServiceLayer, EmailConfigLayer)
      )
    ),
    Layer.provide(OperationalEventRepositoryLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(
      Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
    )
  );
