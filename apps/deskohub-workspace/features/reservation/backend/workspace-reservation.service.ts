import {
  type DotyposReservationId,
  DotyposReservationIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import type { Customer, Reservation, Table } from "@deskohub/dotypos/generated";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  getWorkspaceTableMap,
  type WorkspaceTableMap,
} from "@/features/checkout/workspace-table-map";
import {
  SeatingMapFeatureFlagService,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationIntervalSchema } from "@/features/reservation/reservation-interval";
import { dotyposReservationSeatsSchema } from "@/features/reservation/reservation-seats";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

export class WorkspaceReservationDetailsError extends Data.TaggedError(
  "WorkspaceReservationDetailsError"
)<{
  readonly reservationId: WorkspaceReservationId;
  readonly errorCode:
    | "reservation_load_failed"
    | "dotypos_reservation_missing"
    | "dotypos_reservation_load_failed"
    | "dotypos_reservation_date_invalid"
    | "dotypos_reservation_seats_invalid"
    | "reservation_access_unavailable";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type WorkspaceReservationDetails = Pick<
  WorkspaceReservation,
  "id" | "dotyposCustomerId" | "reservationDetails" | "locale"
> & {
  readonly dotyposReservationId: DotyposReservationId;
  readonly customer: Customer;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
  readonly providerStatus: "NEW" | "CONFIRMED" | "CANCELLED";
  readonly seats: number;
  readonly tableName?: string;
  readonly tableMap?: WorkspaceTableMap;
};

export interface IWorkspaceReservationService {
  readonly getReservation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    WorkspaceReservationDetails,
    WorkspaceReservationDetailsError
  >;
  readonly getAccessTarget: (id: WorkspaceReservationId) => Effect.Effect<
    {
      readonly reservedFrom: Temporal.Instant;
      readonly reservedUntil: Temporal.Instant;
    },
    WorkspaceReservationDetailsError
  >;
}

export class WorkspaceReservationService extends Context.Service<
  WorkspaceReservationService,
  IWorkspaceReservationService
>()("@deskohub-workspace/reservation/WorkspaceReservationService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const dotypos = yield* DotyposService;
      const seatingMapFeatureFlag = yield* SeatingMapFeatureFlagService;

      const loadReservation = Effect.fn("workspaceReservation.load")(function* (
        id: WorkspaceReservationId
      ) {
        return yield* reservations.findById(id).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceReservationDetailsError({
                reservationId: id,
                errorCode: "reservation_load_failed",
                message: "Workspace reservation could not be loaded.",
                cause,
              })
          )
        );
      });

      const getDotyposReservationId = Effect.fn(
        "workspaceReservation.getDotyposReservationId"
      )(function* (reservation: WorkspaceReservation) {
        const rawDotyposReservationId =
          reservation.dotyposReservationId?.trim();
        if (!rawDotyposReservationId) {
          return yield* new WorkspaceReservationDetailsError({
            reservationId: reservation.id,
            errorCode: "dotypos_reservation_missing",
            message: "Workspace reservation has no Dotypos reservation ID.",
          });
        }
        return Schema.decodeUnknownSync(DotyposReservationIdSchema)(
          rawDotyposReservationId
        );
      });

      const loadDotyposReservation = Effect.fn(
        "workspaceReservation.loadDotyposReservation"
      )(function* (reservation: WorkspaceReservation) {
        const dotyposReservationId =
          yield* getDotyposReservationId(reservation);

        return yield* Effect.all(
          [dotypos.getReservation(dotyposReservationId), dotypos.getTables()],
          { concurrency: "inherit" }
        ).pipe(
          Effect.map(([dotyposReservationDetails, tables]) => ({
            dotyposReservationId,
            dotyposReservationDetails,
            tables,
          })),
          Effect.mapError(
            (cause) =>
              new WorkspaceReservationDetailsError({
                reservationId: reservation.id,
                errorCode: "dotypos_reservation_load_failed",
                message: "Workspace Dotypos reservation could not be loaded.",
                cause,
              })
          )
        );
      });

      const buildDetails = Effect.fn("workspaceReservation.buildDetails")(
        function* (reservation: WorkspaceReservation) {
          const { dotyposReservationDetails, dotyposReservationId, tables } =
            yield* loadDotyposReservation(reservation);
          const { reservedFrom, reservedUntil } =
            yield* getDotyposReservationTiming({
              reservationId: reservation.id,
              reservation: dotyposReservationDetails.reservation,
            });
          const seats = yield* Schema.decodeUnknownEffect(
            dotyposReservationSeatsSchema
          )(dotyposReservationDetails.reservation.seats).pipe(
            Effect.mapError(
              (cause) =>
                new WorkspaceReservationDetailsError({
                  reservationId: reservation.id,
                  errorCode: "dotypos_reservation_seats_invalid",
                  message: "Workspace Dotypos reservation seats are invalid.",
                  cause,
                })
            )
          );

          const tableName = getReservationTableName(
            dotyposReservationDetails.reservation,
            tables
          );
          const seatingMapEnabled = yield* seatingMapFeatureFlag.isEnabled;
          const tableMap = seatingMapEnabled
            ? getWorkspaceTableMap(
                dotyposReservationDetails.reservation,
                tables
              )
            : undefined;

          return {
            id: reservation.id,
            dotyposCustomerId: reservation.dotyposCustomerId,
            dotyposReservationId,
            reservationDetails: reservation.reservationDetails,
            locale: reservation.locale,
            customer: dotyposReservationDetails.customer,
            providerStatus: dotyposReservationDetails.reservation.status,
            reservedFrom,
            reservedUntil,
            seats,
            ...(tableName && { tableName }),
            ...(tableMap && { tableMap }),
          };
        }
      );

      return {
        getAccessTarget: Effect.fn("workspaceReservation.getAccessTarget")(
          function* (id) {
            const reservation = yield* loadReservation(id);
            if (
              !reservation ||
              reservation.paymentState !== "paid" ||
              reservation.reservationState !== "confirmed"
            ) {
              return yield* accessUnavailable(id);
            }
            const dotyposReservationId =
              yield* getDotyposReservationId(reservation);
            const dotyposReservationDetails = yield* dotypos
              .getReservation(dotyposReservationId)
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new WorkspaceReservationDetailsError({
                      reservationId: id,
                      errorCode: "dotypos_reservation_load_failed",
                      message:
                        "Workspace Dotypos reservation could not be loaded.",
                      cause,
                    })
                )
              );
            if (dotyposReservationDetails.reservation.status !== "CONFIRMED") {
              return yield* accessUnavailable(id);
            }
            return yield* getDotyposReservationTiming({
              reservationId: id,
              reservation: dotyposReservationDetails.reservation,
            });
          }
        ),
        getReservation: Effect.fn("workspaceReservation.getReservation")(
          function* (id) {
            const reservation = yield* loadReservation(id);
            if (!reservation) {
              return yield* new WorkspaceReservationDetailsError({
                reservationId: id,
                errorCode: "reservation_load_failed",
                message: "Workspace reservation was not found.",
              });
            }
            return yield* buildDetails(reservation);
          }
        ),
      };
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(WorkspaceReservationRepository.Live),
    Layer.provide(WorkspaceDatabase.Live),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(
      SeatingMapFeatureFlagService.Live.pipe(
        Layer.provide(WorkspaceFeatureFlagService.Live)
      )
    )
  );
}

const accessUnavailable = (reservationId: WorkspaceReservationId) =>
  Effect.fail(
    new WorkspaceReservationDetailsError({
      reservationId,
      errorCode: "reservation_access_unavailable",
      message: "Reservation access is not available for recovery.",
    })
  );

export const getDotyposReservationTiming = Effect.fn(
  "dotyposReservation.getTiming"
)(function* (input: {
  readonly reservationId: WorkspaceReservationId;
  readonly reservation: Pick<Reservation, "startDate" | "endDate">;
}) {
  const { startsAt, endsAt } = yield* Schema.decodeUnknownEffect(
    reservationIntervalSchema
  )({
    startsAt: input.reservation.startDate,
    endsAt: input.reservation.endDate,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new WorkspaceReservationDetailsError({
          reservationId: input.reservationId,
          errorCode: "dotypos_reservation_date_invalid",
          message: "Workspace Dotypos reservation interval is invalid.",
          cause,
        })
    )
  );

  return {
    reservedFrom: Temporal.Instant.from(startsAt),
    reservedUntil: Temporal.Instant.from(endsAt),
  };
});

const getReservationTableName = (
  reservation: Reservation,
  tables: readonly Table[]
) => {
  const tableId = reservation._tableId?.trim();
  if (!tableId) return undefined;

  const tableName = tables
    .find((table) => table.id?.trim() === tableId)
    ?.name?.trim();

  return tableName || tableId;
};
