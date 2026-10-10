import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  type ValidationError,
} from "@deskohub/dotypos";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Match } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import { isWorkspaceCoworkCurrentProductTier } from "@/features/checkout/product-catalog";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { findMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-time";
import { getOfficeReservationSelection } from "@/features/reservation/office-reservation";
import type {
  CustomerLastReservation,
  CustomerLastReservationForKind,
} from "@/features/reservation/reservation-existing-customer";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

type CustomerLastReservationError =
  | EffectDrizzleQueryError
  | SqlError
  | ExternalAPIError
  | NetworkError
  | ValidationError;

const toInstant = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    return Temporal.Instant.from(value);
  } catch {
    return null;
  }
};

const getBookedInterval = (reservation: DotyposReservation | undefined) => {
  const startsAt = toInstant(reservation?.startDate);
  const endsAt = toInstant(reservation?.endDate);
  return startsAt && endsAt ? { startsAt, endsAt } : null;
};

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

      const readBookedInterval = (
        dotyposReservationId: DotyposReservationId | null
      ) =>
        dotyposReservationId
          ? dotypos.listReservations({ ids: [dotyposReservationId] }).pipe(
              Effect.map((reservations) => ({
                interval: getBookedInterval(reservations[0]),
                seats: reservations[0]?.seats,
              }))
            )
          : Effect.succeed({ interval: null, seats: undefined });

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
              sql`${workspaceReservations.reservationDetails}->>'kind' = ${kind}`
            )
          )
          .orderBy(desc(workspaceReservations.createdAt))
          .limit(1);
        if (!row) return null;

        return yield* Match.value(row.reservationDetails).pipe(
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
              readBookedInterval(row.dotyposReservationId).pipe(
                Effect.map(({ interval }): CustomerLastReservation | null => {
                  const duration =
                    interval && findMeetingRoomReservationDuration(interval);
                  return duration
                    ? {
                        kind: "meeting-room",
                        duration:
                          getMeetingRoomReservationDurationKey(duration),
                      }
                    : null;
                })
              ),
            office: () =>
              readBookedInterval(row.dotyposReservationId).pipe(
                Effect.map(
                  ({ interval, seats }): CustomerLastReservation | null => {
                    const selection =
                      interval &&
                      seats &&
                      /^\d+$/.test(seats) &&
                      getOfficeReservationSelection({
                        ...interval,
                        seats: Number(seats),
                      });
                    return selection ? { kind: "office", ...selection } : null;
                  }
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
