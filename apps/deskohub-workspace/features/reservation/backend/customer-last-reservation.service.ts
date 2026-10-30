import {
  type DotyposCustomerId,
  type DotyposReadFailure,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Match, Option } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import { isWorkspaceCoworkCurrentProductTier } from "@/features/checkout/product-catalog";
import {
  type BookedReservation,
  decodeBookedReservation,
} from "@/features/reservation/backend/booked-reservation";
import { StoredReservationDetails } from "@/features/reservation/backend/stored-reservation-details.server";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { findMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-time";
import { getOfficeReservationSelection } from "@/features/reservation/office-reservation";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import type {
  CustomerLastReservation,
  CustomerLastReservationForKind,
} from "@/features/reservation/reservation-existing-customer";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

type CustomerLastReservationError =
  | EffectDrizzleQueryError
  | SqlError
  | DotyposReadFailure;

interface ICustomerLastReservationService {
  /**
   * The options of the customer's latest confirmed reservation of a family,
   * or null when there is none or it no longer maps onto a current offer.
   */
  readonly load: <Kind extends WorkspaceReservationKind>(
    dotyposCustomerId: DotyposCustomerId,
    kind: Kind
  ) => Effect.Effect<
    CustomerLastReservationForKind<Kind> | null,
    CustomerLastReservationError
  >;
}

export class CustomerLastReservationService extends Context.Service<
  CustomerLastReservationService,
  ICustomerLastReservationService
>()("@deskohub-workspace/reservation/CustomerLastReservationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;

      // None when the row has no Dotypos reservation or Dotypos lost it. Both
      // families then give no last reservation, as does an unreadable
      // interval, and for offices unreadable seats.
      const readBooked = ({
        dotyposReservationId,
        reservationDetails,
      }: {
        readonly dotyposReservationId: DotyposReservationId | null;
        readonly reservationDetails: StoredWorkspaceReservationDetails;
      }): Effect.Effect<
        Option.Option<BookedReservation>,
        DotyposReadFailure
      > =>
        dotyposReservationId
          ? dotypos
              .getReservationsByIds([dotyposReservationId])
              .pipe(
                Effect.map((reservations) =>
                  Option.map(
                    Option.fromUndefinedOr(
                      reservations.get(dotyposReservationId)
                    ),
                    (reservation) =>
                      decodeBookedReservation(reservation, reservationDetails)
                  )
                )
              )
          : Effect.succeed(Option.none());

      const load = Effect.fn("CustomerLastReservationService.load")(function* (
        dotyposCustomerId: DotyposCustomerId,
        kind: WorkspaceReservationKind
      ) {
        const [row] = yield* db
          .select({
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            reservationDetails: workspaceReservations.reservationDetails,
          })
          .from(workspaceReservations)
          .where(
            and(
              eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId),
              isNotNull(workspaceReservations.reservationConfirmedAt),
              sql`${StoredReservationDetails.kind} = ${kind}`
            )
          )
          .orderBy(desc(workspaceReservations.createdAt))
          .limit(1);
        if (!row) return null;
        // A malformed document names no options to repeat.
        const stored = StoredReservationDetails.project(row.reservationDetails);
        if (Option.isNone(stored)) return null;
        const reservationDetails = stored.value;
        const booking = {
          dotyposReservationId: row.dotyposReservationId,
          reservationDetails,
        };

        return yield* Match.value(reservationDetails).pipe(
          Match.discriminatorsExhaustive("kind")({
            cowork: (details) =>
              Effect.succeed<CustomerLastReservation | null>(
                isWorkspaceCoworkCurrentProductTier(details.entryTier)
                  ? {
                      kind: "cowork",
                      entryTier: details.entryTier,
                      coffee: details.coffee,
                      ...(details.monitorOption && {
                        monitorOption: details.monitorOption,
                      }),
                    }
                  : null
              ),
            "meeting-room": () =>
              readBooked(booking).pipe(
                Effect.map((booked): CustomerLastReservation | null =>
                  booked.pipe(
                    Option.flatMap(({ interval }) => interval),
                    Option.flatMapNullishOr(findMeetingRoomReservationDuration),
                    Option.map(
                      (duration): CustomerLastReservation => ({
                        kind: "meeting-room",
                        duration:
                          getMeetingRoomReservationDurationKey(duration),
                      })
                    ),
                    Option.getOrNull
                  )
                )
              ),
            office: () =>
              readBooked(booking).pipe(
                Effect.map((booked): CustomerLastReservation | null =>
                  booked.pipe(
                    Option.flatMap(({ interval, seats }) =>
                      Option.all({ interval, seats })
                    ),
                    Option.flatMapNullishOr(({ interval, seats }) =>
                      getOfficeReservationSelection({ ...interval, seats })
                    ),
                    Option.map(
                      (selection): CustomerLastReservation => ({
                        kind: "office",
                        ...selection,
                      })
                    ),
                    Option.getOrNull
                  )
                )
              ),
          })
        );
      }) as ICustomerLastReservationService["load"];

      return { load } satisfies ICustomerLastReservationService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(WorkspaceDatabase.Default, WorkspaceDotyposLayer)
    )
  );
}
