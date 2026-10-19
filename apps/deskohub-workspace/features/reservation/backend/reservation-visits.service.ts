import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  type DotyposReservationStatus,
  DotyposService,
  dotyposIdFilterBatchSize,
  ExternalAPIError,
  type NetworkError,
  readInIdFilterBatches,
  ValidationError,
} from "@deskohub/dotypos";
import { and, count, inArray, isNotNull, type SQL } from "drizzle-orm";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import { bookedReservationCondition } from "@/features/administration/reservation-status-condition";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationIntervalSchema } from "@/features/reservation/reservation-interval";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

/** A Workspace-booked reservation with its live Dotypos times and status. */
export type ReservationVisit = {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly dotyposReservationId: DotyposReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly status: "active" | "cancelled";
};

/**
 * A half-open window. A visit is active during it when
 * `startsAt < visit.endsAt && visit.startsAt < endsAt`.
 */
export type ReservationVisitWindow = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
};

type ReservationVisitsPage = {
  readonly visits: ReadonlyArray<ReservationVisit>;
  readonly nextPage: Option.Option<number>;
};

/**
 * Dotypos couldn't answer a visit read. It carries only the Dotypos error,
 * never reservation values; the caller retries through queue redelivery.
 */
export class ReservationVisitsUnavailable extends Data.TaggedError(
  "ReservationVisitsUnavailable"
)<{
  readonly cause: ValidationError | ExternalAPIError | NetworkError;
}> {
  static fromDotypos = (
    cause: ValidationError | ExternalAPIError | NetworkError
  ) => new ReservationVisitsUnavailable({ cause });
}

interface IReservationVisits {
  /** Each id maps to `None` when it isn't booked or Dotypos doesn't return it. */
  readonly ofReservations: (
    ids: ReadonlyArray<WorkspaceReservationId>
  ) => Effect.Effect<
    ReadonlyMap<WorkspaceReservationId, Option.Option<ReservationVisit>>,
    ReservationVisitsUnavailable
  >;
  /** Each customer's Workspace-booked reservations that Dotypos returns. */
  readonly ofCustomers: (
    ids: ReadonlyArray<DotyposCustomerId>
  ) => Effect.Effect<
    ReadonlyMap<DotyposCustomerId, ReadonlyArray<ReservationVisit>>,
    ReservationVisitsUnavailable
  >;
  /** One Dotypos page of the Workspace-booked visits active during the window. */
  readonly activeDuring: (
    window: ReservationVisitWindow,
    page: number
  ) => Effect.Effect<ReservationVisitsPage, ReservationVisitsUnavailable>;
  /**
   * How many reservations `ofCustomers` reads for each customer; a customer
   * without any is absent. Unit packing sizes its units from these.
   */
  readonly bookings: (
    customers: ReadonlyArray<DotyposCustomerId>
  ) => Effect.Effect<ReadonlyMap<DotyposCustomerId, number>>;
  /** The most Dotypos requests `ofCustomers` makes for these customers. */
  readonly cost: (
    customers: ReadonlyArray<DotyposCustomerId>
  ) => Effect.Effect<number>;
}

/**
 * The only way to learn a Workspace reservation's visit times and status.
 * Workspace decides which reservations count (booked, with a Dotypos
 * reservation); Dotypos supplies their times and status. Nothing is stored:
 * each Layer build memoises visits by reservation id for its own lifetime, so
 * build one per unit of work. Local database failures are defects.
 */
export class ReservationVisits extends Context.Service<
  ReservationVisits,
  IReservationVisits
>()("@deskohub-workspace/reservation/ReservationVisits") {
  // `fresh` keeps a runtime's shared memo map from reusing one build's memo
  // across units of work.
  static Default = Layer.fresh(
    Layer.effect(
      this,
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const dotypos = yield* DotyposService;
        const memo = new Map<
          WorkspaceReservationId,
          Option.Option<ReservationVisit>
        >();

        const ofReservations = Effect.fn("ReservationVisits.ofReservations")(
          function* (ids: ReadonlyArray<WorkspaceReservationId>) {
            const booked =
              ids.length === 0
                ? []
                : yield* readBooked(
                    inArray(workspaceReservations.id, [...ids])
                  );
            yield* lookUp(booked);
            const visits: ReadonlyMap<
              WorkspaceReservationId,
              Option.Option<ReservationVisit>
            > = new Map(ids.map((id) => [id, memoised(id)]));
            return visits;
          }
        );

        const ofCustomers = Effect.fn("ReservationVisits.ofCustomers")(
          function* (ids: ReadonlyArray<DotyposCustomerId>) {
            const booked =
              ids.length === 0
                ? []
                : yield* readBooked(
                    inArray(workspaceReservations.dotyposCustomerId, [...ids])
                  );
            yield* lookUp(booked);
            const visits = new Map<DotyposCustomerId, ReservationVisit[]>(
              ids.map((id) => [id, []])
            );
            for (const reservation of booked) {
              const visit = memoised(reservation.workspaceReservationId);
              if (Option.isSome(visit)) {
                visits.get(reservation.dotyposCustomerId)?.push(visit.value);
              }
            }
            const result: ReadonlyMap<
              DotyposCustomerId,
              ReadonlyArray<ReservationVisit>
            > = visits;
            return result;
          }
        );

        const activeDuring = Effect.fn("ReservationVisits.activeDuring")(
          function* (window: ReservationVisitWindow, page: number) {
            const result = yield* dotypos
              .listActiveReservationsPage(
                {
                  startDate: new Date(window.startsAt.epochMilliseconds),
                  endDate: new Date(window.endsAt.epochMilliseconds),
                },
                page
              )
              .pipe(Effect.mapError(ReservationVisitsUnavailable.fromDotypos));
            const dotyposIds = result.reservations.flatMap((reservation) =>
              reservation.id === undefined ? [] : [reservation.id]
            );
            const booked =
              dotyposIds.length === 0
                ? []
                : yield* readBooked(
                    inArray(
                      workspaceReservations.dotyposReservationId,
                      dotyposIds
                    )
                  );
            const visits = yield* remember(booked, result.reservations);
            return { visits, nextPage: result.nextPage };
          }
        );

        const cost = Effect.fn("ReservationVisits.cost")(function* (
          customers: ReadonlyArray<DotyposCustomerId>
        ) {
          if (customers.length === 0) return 0;
          const [row] = yield* db
            .select({ booked: count() })
            .from(workspaceReservations)
            .where(
              and(
                countedReservationCondition,
                inArray(workspaceReservations.dotyposCustomerId, [...customers])
              )
            )
            .pipe(Effect.orDie);
          return Math.ceil((row?.booked ?? 0) / dotyposIdFilterBatchSize);
        });

        const bookings = Effect.fn("ReservationVisits.bookings")(function* (
          customers: ReadonlyArray<DotyposCustomerId>
        ) {
          if (customers.length === 0) {
            return new Map<DotyposCustomerId, number>();
          }
          const rows = yield* db
            .select({
              dotyposCustomerId: workspaceReservations.dotyposCustomerId,
              booked: count(),
            })
            .from(workspaceReservations)
            .where(
              and(
                countedReservationCondition,
                inArray(workspaceReservations.dotyposCustomerId, [...customers])
              )
            )
            .groupBy(workspaceReservations.dotyposCustomerId)
            .pipe(Effect.orDie);
          const booked: ReadonlyMap<DotyposCustomerId, number> = new Map(
            rows.map((row) => [row.dotyposCustomerId, row.booked])
          );
          return booked;
        });

        const memoised = (id: WorkspaceReservationId) =>
          memo.get(id) ?? Option.none<ReservationVisit>();

        /** Reads the counted reservations that match `condition`. */
        const readBooked = (condition: SQL) =>
          db
            .select({
              workspaceReservationId: workspaceReservations.id,
              dotyposCustomerId: workspaceReservations.dotyposCustomerId,
              dotyposReservationId: workspaceReservations.dotyposReservationId,
            })
            .from(workspaceReservations)
            .where(and(countedReservationCondition, condition))
            .pipe(
              Effect.map((rows) =>
                rows.flatMap(
                  ({
                    dotyposReservationId,
                    ...reservation
                  }): BookedReservation[] =>
                    dotyposReservationId === null
                      ? []
                      : [{ ...reservation, dotyposReservationId }]
                )
              ),
              Effect.orDie
            );

        /**
         * Fetches the visits not memoised yet, ≤ 50 Dotypos ids per request,
         * one request at a time.
         */
        const lookUp = (booked: readonly BookedReservation[]) =>
          readInIdFilterBatches(
            booked
              .filter(
                (reservation) => !memo.has(reservation.workspaceReservationId)
              )
              .map((reservation) => reservation.dotyposReservationId),
            (ids) =>
              dotypos.listReservationsPage({ ids, page: 1 }).pipe(
                Effect.filterOrFail(
                  (result) => Option.isNone(result.nextPage),
                  () =>
                    new ExternalAPIError({
                      service: "Dotypos",
                      operation: "listReservationsPage",
                      message: "Dotypos paged an id-filtered reservation read",
                      statusCode: 502,
                    })
                ),
                Effect.mapError(ReservationVisitsUnavailable.fromDotypos)
              ),
            // A unit's requests are sequential, so in-flight units bound Dotypos load.
            { concurrency: 1 }
          ).pipe(
            Effect.flatMap((pages) =>
              remember(
                booked,
                pages.flatMap((result) => result.reservations)
              )
            ),
            Effect.tap(() =>
              Effect.sync(() => {
                for (const reservation of booked) {
                  if (!memo.has(reservation.workspaceReservationId)) {
                    memo.set(reservation.workspaceReservationId, Option.none());
                  }
                }
              })
            )
          );

        /** Joins Dotypos rows to booked reservations and memoises the visits. */
        const remember = (
          booked: readonly BookedReservation[],
          reservations: readonly DotyposReservation[]
        ) => {
          const bookedByDotyposId = new Map(
            booked.map((reservation) => [
              reservation.dotyposReservationId,
              reservation,
            ])
          );
          return Effect.forEach(
            reservations.flatMap((reservation) => {
              const match =
                reservation.id === undefined
                  ? undefined
                  : bookedByDotyposId.get(reservation.id);
              return match ? [{ booked: match, reservation }] : [];
            }),
            ({ booked: bookedReservation, reservation }) =>
              toVisit(bookedReservation, reservation).pipe(
                Effect.tap((visit) =>
                  Effect.sync(() =>
                    memo.set(
                      bookedReservation.workspaceReservationId,
                      Option.some(visit)
                    )
                  )
                )
              )
          );
        };

        return { ofReservations, ofCustomers, activeDuring, bookings, cost };
      })
    )
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(WorkspaceDatabase.Default, WorkspaceDotyposLayer)
    )
  );
}

type BookedReservation = {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly dotyposReservationId: DotyposReservationId;
};

/**
 * Booked through Workspace and linked to a Dotypos reservation (D31.6): the
 * reservations `bookings` counts and `ofCustomers` reads.
 */
export const countedReservationCondition = and(
  bookedReservationCondition,
  isNotNull(workspaceReservations.dotyposReservationId)
)!;

const visitStatuses = {
  NEW: "active",
  CONFIRMED: "active",
  CANCELLED: "cancelled",
} as const satisfies Record<
  DotyposReservationStatus,
  ReservationVisit["status"]
>;

const toVisit = (
  booked: BookedReservation,
  reservation: DotyposReservation
): Effect.Effect<ReservationVisit, ReservationVisitsUnavailable> =>
  Schema.decodeEffect(reservationIntervalSchema)({
    startsAt: reservation.startDate,
    endsAt: reservation.endDate,
  }).pipe(
    // The schema issue quotes the times, so only its kind is kept.
    Effect.mapError(
      () =>
        new ReservationVisitsUnavailable({
          cause: new ValidationError({
            message: "Dotypos returned an invalid reservation interval",
          }),
        })
    ),
    Effect.map(
      ({ startsAt, endsAt }): ReservationVisit => ({
        workspaceReservationId: booked.workspaceReservationId,
        dotyposReservationId: booked.dotyposReservationId,
        dotyposCustomerId: booked.dotyposCustomerId,
        startsAt: Temporal.Instant.from(startsAt),
        endsAt: Temporal.Instant.from(endsAt),
        status: visitStatuses[reservation.status],
      })
    )
  );
