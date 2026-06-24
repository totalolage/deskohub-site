import { DotyposService } from "@deskohub/dotypos";
import type { Customer, Reservation, Table } from "@deskohub/dotypos/generated";
import { Context, Data, Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema/workspace-reservations";
import {
  getWorkspaceTableMap,
  type WorkspaceTableMap,
} from "@/features/checkout/workspace-table-map";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";

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
  | "productTier"
  | "productCoffee"
  | "productMonitorOption"
  | "locale"
> & {
  readonly dotyposReservationId: string;
  readonly customer: Customer;
  readonly reservedFrom: Date;
  readonly reservedUntil: Date;
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
          return yield* Effect.fail(
            new WorkspaceReservationDetailsError({
              reservationId: reservation.id,
              errorCode: "dotypos_reservation_missing",
              message: "Workspace reservation has no Dotypos reservation ID.",
            })
          );
        }

        return yield* Effect.all(
          [dotypos.getReservation(dotyposReservationId), dotypos.getTables()],
          { concurrency: 2 }
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
          const reservedFrom = yield* parseDotyposReservationDate({
            reservationId: reservation.id,
            value: dotyposReservationDetails.reservation.startDate,
            fieldName: "startDate",
          });
          const reservedUntil = yield* parseDotyposReservationDate({
            reservationId: reservation.id,
            value: dotyposReservationDetails.reservation.endDate,
            fieldName: "endDate",
          });

          if (reservedUntil <= reservedFrom) {
            return yield* Effect.fail(
              new WorkspaceReservationDetailsError({
                reservationId: reservation.id,
                errorCode: "dotypos_reservation_date_invalid",
                message:
                  "Workspace Dotypos reservation end date must be after start date.",
              })
            );
          }

          const tableName = getReservationTableName(
            dotyposReservationDetails.reservation,
            tables
          );
          const tableMap = getWorkspaceTableMap(
            dotyposReservationDetails.reservation,
            tables
          );

          return {
            id: reservation.id,
            dotyposCustomerId: reservation.dotyposCustomerId,
            dotyposReservationId,
            customerAccessCode: reservation.customerAccessCode,
            productTier: reservation.productTier,
            productCoffee: reservation.productCoffee,
            productMonitorOption: reservation.productMonitorOption,
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
              return yield* Effect.fail(
                new WorkspaceReservationDetailsError({
                  reservationId: id,
                  errorCode: "reservation_load_failed",
                  message: "Workspace reservation was not found.",
                })
              );
            }
            return yield* buildDetails(reservation);
          }
        ),
      };
    })
  );
}

const parseDotyposReservationDate = (input: {
  readonly reservationId: string;
  readonly value: string;
  readonly fieldName: "startDate" | "endDate";
}): Effect.Effect<Date, WorkspaceReservationDetailsError> =>
  Effect.sync(() => {
    const value = input.value.trim();
    return new Date(/^\d+$/.test(value) ? Number(value) : value);
  }).pipe(
    Effect.filterOrFail(
      (date) => !Number.isNaN(date.getTime()),
      () =>
        new WorkspaceReservationDetailsError({
          reservationId: input.reservationId,
          errorCode: "dotypos_reservation_date_invalid",
          message: `Workspace Dotypos reservation ${input.fieldName} is invalid.`,
        })
    )
  );

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
