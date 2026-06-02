import { DotyposService } from "@deskohub/dotypos";
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
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";

export type WorkspacePaidFulfillmentFailureCode =
  | "dotypos_reservation_failed"
  | "dotypos_reservation_unfulfillable"
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

    const failFulfillment = Effect.fn("workspacePaidFulfillment.fail")(
      function* (input: {
        readonly orderId: string;
        readonly failureCode: WorkspacePaidFulfillmentFailureCode;
        readonly eventType:
          | "workspace_paid_fulfillment_missing_hold"
          | "workspace_paid_fulfillment_no_longer_confirmable"
          | "workspace_paid_fulfillment_confirm_failed"
          | "workspace_paid_fulfillment_mark_fulfilled_failed";
        readonly cause?: unknown;
      }) {
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

          if (
            !reservation ||
            reservation.paymentState !== "paid" ||
            reservation.fulfillmentState === "fulfilled" ||
            reservation.fulfillmentState === "processing"
          ) {
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

          if (!claimed) return;

          if (!claimed.dotyposReservationId) {
            return yield* failFulfillment({
              orderId: input.orderId,
              failureCode: "dotypos_reservation_unfulfillable",
              eventType: "workspace_paid_fulfillment_missing_hold",
            });
          }

          if (claimed.reservationState !== "confirmed") {
            if (claimed.reservationState !== "held") {
              return yield* failFulfillment({
                orderId: input.orderId,
                failureCode: "dotypos_reservation_unfulfillable",
                eventType: "workspace_paid_fulfillment_no_longer_confirmable",
              });
            }

            yield* dotypos
              .confirmReservation(claimed.dotyposReservationId)
              .pipe(
                Effect.catchAll((cause) =>
                  failFulfillment({
                    orderId: input.orderId,
                    failureCode: "dotypos_reservation_failed",
                    eventType: "workspace_paid_fulfillment_confirm_failed",
                    cause,
                  })
                )
              );

            yield* reservations.markReservationConfirmed({
              id: claimed.id,
              confirmedAt: new Date(),
            });
          }

          yield* reservations
            .markFulfilled({
              id: claimed.id,
              fulfilledAt: new Date(),
            })
            .pipe(
              Effect.catchAll((cause) =>
                failFulfillment({
                  orderId: input.orderId,
                  failureCode: "fulfillment_completion_failed",
                  eventType: "workspace_paid_fulfillment_mark_fulfilled_failed",
                  cause,
                })
              )
            );
        },
        (effect, input) =>
          effect.pipe(
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
    Layer.provide(OperationalEventRepositoryLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(
      Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
    )
  );
