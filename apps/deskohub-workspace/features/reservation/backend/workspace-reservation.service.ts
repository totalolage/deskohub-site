import {
  type DotyposReservationId,
  DotyposReservationIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import type { Customer } from "@deskohub/dotypos/generated";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
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
  type BookedReservation,
  decodeBookedReservation,
} from "@/features/reservation/backend/booked-reservation";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

import {
  getOpenSpaceTableNames,
  getReservationTableName,
} from "./reservation-table";

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
  | "id"
  | "dotyposCustomerId"
  | "authorAccountId"
  | "reservationDetails"
  | "locale"
> & {
  readonly dotyposReservationId: DotyposReservationId;
  readonly customer: Customer;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
  /**
   * When an early-setup meeting room is held from, before `reservedFrom`. The
   * customer may arrive then, and the door code works from then.
   */
  readonly setupFrom?: Temporal.Instant;
  readonly providerStatus: "NEW" | "CONFIRMED" | "CANCELLED";
  readonly seats: number;
  readonly tableName?: string;
  readonly tableMap?: WorkspaceTableMap;
  readonly openSpaceTableNames?: readonly string[];
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
  static Default = Layer.effect(
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
          [
            // A reservation Dotypos no longer has fails the same load error.
            dotypos
              .getReservation(dotyposReservationId)
              .pipe(Effect.flatMap(Effect.fromOption)),
            dotypos.getTables(),
          ],
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
          const booked = decodeBookedReservation(
            dotyposReservationDetails.reservation,
            reservation.reservationDetails
          );
          const { reservedFrom, reservedUntil } =
            yield* getDotyposReservationTiming({
              reservationId: reservation.id,
              reservation: booked,
            });
          if (Option.isNone(booked.seats)) {
            return yield* new WorkspaceReservationDetailsError({
              reservationId: reservation.id,
              errorCode: "dotypos_reservation_seats_invalid",
              message: "Workspace Dotypos reservation seats are invalid.",
            });
          }
          const seats = booked.seats.value;

          const tableName = getReservationTableName(
            dotyposReservationDetails.reservation,
            tables
          );
          const openSpaceTableNames =
            reservation.reservationDetails.kind === "cowork" &&
            reservation.reservationDetails.entryTier === "open-space"
              ? yield* getOpenSpaceTableNames(tables)
              : undefined;
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
            authorAccountId: reservation.authorAccountId,
            dotyposReservationId,
            reservationDetails: reservation.reservationDetails,
            locale: reservation.locale,
            customer: dotyposReservationDetails.customer,
            providerStatus: dotyposReservationDetails.reservation.status,
            reservedFrom,
            reservedUntil,
            ...Option.match(booked.setupStart, {
              onNone: () => ({}),
              onSome: (setupFrom) => ({ setupFrom }),
            }),
            seats,
            ...(tableName && { tableName }),
            ...(tableMap && { tableMap }),
            ...(openSpaceTableNames !== undefined && { openSpaceTableNames }),
          };
        }
      );

      return {
        getAccessTarget: Effect.fn("workspaceReservation.getAccessTarget")(
          function* (id) {
            const reservation = yield* loadReservation(id);
            if (
              reservation?.paymentState !== "paid" ||
              reservation.reservationState !== "confirmed"
            ) {
              return yield* accessUnavailable(id);
            }
            const dotyposReservationId =
              yield* getDotyposReservationId(reservation);
            const dotyposReservationDetails = yield* dotypos
              .getReservation(dotyposReservationId)
              .pipe(
                Effect.flatMap(Effect.fromOption),
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
            return yield* getDotyposReservationAccessTiming({
              reservationId: id,
              reservation: decodeBookedReservation(
                dotyposReservationDetails.reservation,
                reservation.reservationDetails
              ),
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

  static Live = this.Default.pipe(
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

const accessUnavailable = (reservationId: WorkspaceReservationId) =>
  Effect.fail(
    new WorkspaceReservationDetailsError({
      reservationId,
      errorCode: "reservation_access_unavailable",
      message: "Reservation access is not available for recovery.",
    })
  );

/** A reservation without a readable interval has no timing. */
export const getDotyposReservationTiming = Effect.fn(
  "dotyposReservation.getTiming"
)(function* (input: {
  readonly reservationId: WorkspaceReservationId;
  readonly reservation: Pick<BookedReservation, "interval">;
}) {
  if (Option.isNone(input.reservation.interval)) {
    return yield* new WorkspaceReservationDetailsError({
      reservationId: input.reservationId,
      errorCode: "dotypos_reservation_date_invalid",
      message: "Workspace Dotypos reservation interval is invalid.",
    });
  }

  const { startsAt, endsAt } = input.reservation.interval.value;
  return { reservedFrom: startsAt, reservedUntil: endsAt };
});

/**
 * The span a reservation's door code covers: the span Dotypos holds, which
 * starts at the setup start of an early-setup meeting room.
 */
export const getDotyposReservationAccessTiming = (input: {
  readonly reservationId: WorkspaceReservationId;
  readonly reservation: Pick<BookedReservation, "occupiedInterval">;
}) =>
  getDotyposReservationTiming({
    reservationId: input.reservationId,
    reservation: { interval: input.reservation.occupiedInterval },
  });
