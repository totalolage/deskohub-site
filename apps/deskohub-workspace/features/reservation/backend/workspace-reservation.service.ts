import { DotyposService } from "@deskohub/dotypos";
import type { Customer, Reservation, Table } from "@deskohub/dotypos/generated";
import { Context, Data, Effect, Layer, Schema } from "effect";
import {
  getWorkspaceTableMap,
  type WorkspaceTableMap,
} from "@/features/checkout/workspace-table-map";
import { SeatingMapFeatureFlagService } from "@/features/feature-flags/backend";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { reservationIntervalSchema } from "@/features/reservation/reservation-interval";

export class WorkspaceReservationDetailsError extends Data.TaggedError(
  "WorkspaceReservationDetailsError"
)<{
  readonly reservationId: string;
  readonly errorCode:
    | "reservation_load_failed"
    | "dotypos_reservation_missing"
    | "dotypos_reservation_load_failed"
    | "dotypos_reservation_date_invalid";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type WorkspaceReservationDetails = Pick<
  WorkspaceReservation,
  | "id"
  | "dotyposCustomerId"
  | "customerAccessCode"
  | "reservationDetails"
  | "locale"
> & {
  readonly dotyposReservationId: string;
  readonly customer: Customer;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
  readonly tableName?: string;
  readonly tableMap?: WorkspaceTableMap;
};

export interface IWorkspaceReservationService {
  readonly getReservation: (
    id: string
  ) => Effect.Effect<
    WorkspaceReservationDetails,
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
        id: string
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

      const loadDotyposReservation = Effect.fn(
        "workspaceReservation.loadDotyposReservation"
      )(function* (reservation: WorkspaceReservation) {
        const dotyposReservationId = reservation.dotyposReservationId?.trim();
        if (!dotyposReservationId) {
          return yield* new WorkspaceReservationDetailsError({
            reservationId: reservation.id,
            errorCode: "dotypos_reservation_missing",
            message: "Workspace reservation has no Dotypos reservation ID.",
          });
        }

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
            customerAccessCode: reservation.customerAccessCode,
            reservationDetails: reservation.reservationDetails,
            locale: reservation.locale,
            customer: dotyposReservationDetails.customer,
            reservedFrom,
            reservedUntil,
            ...(tableName && { tableName }),
            ...(tableMap && { tableMap }),
          };
        }
      );

      return {
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
}

export const getDotyposReservationTiming = Effect.fn(
  "dotyposReservation.getTiming"
)(function* (input: {
  readonly reservationId: string;
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
