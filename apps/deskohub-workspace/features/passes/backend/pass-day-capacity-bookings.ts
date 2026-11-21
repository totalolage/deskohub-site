import type { DotyposReservation } from "@deskohub/dotypos";
import { Effect, Array as EffectArray } from "effect";
import {
  getOccupancyWindow,
  type TableBooking,
  toTableBookings,
  workspaceBookingSeatCount,
} from "@/features/checkout/backend/reservation/workspace-table-occupancy";
import type { OrderId } from "@/features/order";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import type {
  PendingPassDayCapacity,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { readPassDayMarkers } from "../pass-day-marker";
import type { UnboundPassDayHold } from "./pass-day-hold-ownership";
import { matchesUnlimitedPassDayHold } from "./unlimited-pass-dotypos-holds";

type CapacityReservation = ReservationRecord &
  Pick<DotyposReservation, "_customerId" | "note">;

const providerHold = ({
  passId,
  serviceDate,
  tableId,
  customerId,
  tier,
  holdGeneration,
}: PendingPassDayCapacity) => ({
  passId,
  customerId,
  generation: holdGeneration,
  day: {
    serviceDate: Temporal.PlainDate.from(serviceDate),
    tableId,
    interval: getCoworkReservationInterval(
      tier === "open-space" ? tier : "reserved-desk",
      serviceDate
    ),
  },
});

const matchingProviderHolds = (
  reservations: readonly CapacityReservation[],
  intent: PendingPassDayCapacity,
  hold: ReturnType<typeof providerHold>
) =>
  EffectArray.dedupeWith(
    reservations.filter(
      (record) =>
        (intent.providerReservationId === null ||
          intent.providerReservationId === record.id) &&
        (record.status === "NEW" || record.status === "CONFIRMED") &&
        matchesUnlimitedPassDayHold(record, hold)
    ),
    (left, right) => left.id === right.id
  );

/** Preserve an observed ambiguity even if a sibling lookup fails. */
export const observePassDayInventory = <
  Reservation extends CapacityReservation,
  E,
  R,
>(
  repository: Pick<
    WorkspaceReservationRepository["Service"],
    "recordAmbiguousPassDayHolds"
  >,
  readReservations: Effect.Effect<readonly Reservation[], E, R>,
  intents: readonly PendingPassDayCapacity[]
) =>
  Effect.uninterruptibleMask(
    Effect.fnUntraced(function* (restore) {
      const reservations = yield* restore(readReservations);
      const ambiguous: UnboundPassDayHold[] = [];
      const passDayIntents = intents.map((intent) => {
        const { passId, serviceDate, holdGeneration, holdRequestedAt } = intent;
        if (
          intent.moveClaim ||
          !holdRequestedAt ||
          intent.providerReservationId ||
          intent.holdAmbiguous ||
          matchingProviderHolds(reservations, intent, providerHold(intent))
            .length < 2
        ) {
          return intent;
        }
        ambiguous.push({
          passId,
          serviceDate,
          holdGeneration,
          holdRequestedAt,
        });
        return { ...intent, holdAmbiguous: true };
      });
      if (ambiguous.length > 0) {
        yield* repository.recordAmbiguousPassDayHolds(ambiguous);
      }
      return { reservations, passDayIntents };
    })
  );

/** A creating pass day already holds capacity, even before Dotypos lists it. */
export const getBookingsWithPassDayIntents = (
  reservations: readonly CapacityReservation[],
  intents: readonly PendingPassDayCapacity[],
  supersedeOrderId?: OrderId
): readonly TableBooking[] => {
  const passDayIds = new Set(
    reservations.flatMap((record) =>
      record.unlimitedPassDay || readPassDayMarkers(record.note).length > 0
        ? [record.id]
        : []
    )
  );
  const countedPassDayIds = new Set<CapacityReservation["id"]>();
  // Match local claims against the same provider records counted in occupancy.
  const activeReservations = reservations.filter((record) => {
    if (record.status !== "NEW" && record.status !== "CONFIRMED") return false;
    if (!passDayIds.has(record.id)) return true;
    if (countedPassDayIds.has(record.id)) return false;
    countedPassDayIds.add(record.id);
    return true;
  });
  const claims = intents.map((intent) => {
    const hold = providerHold(intent);
    const requested =
      intent.holdRequestedAt !== null || intent.providerReservationId !== null;
    const matches =
      !intent.holdAmbiguous && requested
        ? matchingProviderHolds(activeReservations, intent, hold)
        : [];
    return {
      passId: intent.passId,
      canSupersede:
        !intent.moveClaim &&
        !intent.holdAmbiguous &&
        (!requested || intent.providerReservationId !== null),
      visible: matches.length === 1 ? matches[0] : undefined,
      booking: {
        ...getOccupancyWindow(hold.day.interval),
        tableId: intent.tableId,
        seats: workspaceBookingSeatCount,
      },
    };
  });
  const excluded = new Set(
    claims.flatMap((claim) =>
      claim.passId === supersedeOrderId && claim.canSupersede && claim.visible
        ? [claim.visible.id]
        : []
    )
  );
  const providerBookings = toTableBookings(
    activeReservations.filter((record) => !excluded.has(record.id))
  );
  const localBookings = claims.flatMap((claim) =>
    claim.visible || (claim.passId === supersedeOrderId && claim.canSupersede)
      ? []
      : [claim.booking]
  );
  return [...providerBookings, ...localBookings];
};
