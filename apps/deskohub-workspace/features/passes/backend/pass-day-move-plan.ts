import type {
  DotyposReservationId,
  DotyposTable,
  DotyposTableId,
} from "@deskohub/dotypos";
import { Result } from "effect";
import {
  getOccupancyWindow,
  getTableBookingOccupancyById,
  type OccupancyWindow,
  type TableBooking,
  workspaceBookingSeatCount,
} from "@/features/checkout/backend/reservation/workspace-table-occupancy";
import {
  decodeTableCandidates,
  getWorkspaceTableCandidatesByPredicate,
  hasCandidateCapacity,
  isWorkspaceCoworkTableCandidate,
  type WorkspaceTableCandidate,
} from "@/features/checkout/backend/reservation/workspace-table-selection";
import type { OrderId } from "@/features/order";
import type { PendingPassDayCapacity } from "@/features/reservation/backend/workspace-reservation.repository";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { PlainDate } from "@/shared/utils/temporal";
import { matchesUnlimitedPassDayHold } from "./unlimited-pass-dotypos-holds";

export type MovablePassDay = {
  readonly reservationId: WorkspaceReservationId;
  readonly passId: OrderId;
  readonly serviceDate: PlainDate;
  readonly sourceReservationId: DotyposReservationId;
  readonly booking: TableBooking;
};

export type PassDayMovePlan = {
  readonly source: MovablePassDay;
  readonly targetTableId: DotyposTableId;
};

export const findMovablePassDays = (
  reservations: readonly (Parameters<typeof matchesUnlimitedPassDayHold>[0] & {
    readonly id: DotyposReservationId;
    readonly status?: string | null;
  })[],
  claims: readonly PendingPassDayCapacity[],
  today: Temporal.PlainDate
): readonly MovablePassDay[] => {
  const providerById = new Map(
    reservations.map((record) => [record.id, record])
  );
  return claims.flatMap((claim) => {
    const { movableReservationId, providerReservationId, serviceDate } = claim;
    if (
      !movableReservationId ||
      !providerReservationId ||
      serviceDate <= today.toString()
    ) {
      return [];
    }
    const record = providerById.get(providerReservationId);
    const interval = getCoworkReservationInterval("open-space", serviceDate);
    if (
      record?.status !== "CONFIRMED" ||
      !matchesUnlimitedPassDayHold(record, {
        passId: claim.passId,
        customerId: claim.customerId,
        day: {
          serviceDate: Temporal.PlainDate.from(serviceDate),
          tableId: claim.tableId,
          interval,
        },
        generation: claim.holdGeneration,
      })
    ) {
      return [];
    }
    return [
      {
        reservationId: movableReservationId,
        passId: claim.passId,
        serviceDate,
        sourceReservationId: providerReservationId,
        booking: {
          ...getOccupancyWindow(interval),
          tableId: claim.tableId,
          seats: workspaceBookingSeatCount,
        },
      },
    ];
  });
};

/** Moving one day must make the blocked table usable for the ordinary booking. */
export const planPassDayMove = ({
  sources,
  bookings,
  tables,
  candidates,
  window,
  occupancy,
  seats,
  requireEmpty,
}: {
  readonly sources: readonly MovablePassDay[];
  readonly bookings: readonly TableBooking[];
  readonly tables: readonly DotyposTable[];
  readonly candidates: readonly WorkspaceTableCandidate[];
  readonly window: OccupancyWindow;
  readonly occupancy: ReadonlyMap<DotyposTableId, number>;
  readonly seats: number;
  readonly requireEmpty: boolean;
}): PassDayMovePlan | undefined => {
  if (
    sources.length === 0 ||
    hasCandidateCapacity(candidates, occupancy, seats, requireEmpty)
  )
    return;

  const destinations = getWorkspaceTableCandidatesByPredicate(tables, (tags) =>
    isWorkspaceCoworkTableCandidate(tags, { entryTier: "open-space" })
  );
  const sourceByTable = new Map(
    candidates.map((candidate) => [candidate.table.id, candidate])
  );
  for (const source of sources) {
    const { startsAt, endsAt, tableId } = source.booking;
    const candidate = sourceByTable.get(tableId);
    const occupiedSeats = occupancy.get(tableId) ?? 0;
    if (
      !candidate ||
      startsAt >= window.endsAt ||
      endsAt <= window.startsAt ||
      occupiedSeats < source.booking.seats ||
      !hasCandidateCapacity(
        [candidate],
        new Map([[tableId, occupiedSeats - source.booking.seats]]),
        seats,
        requireEmpty
      )
    ) {
      continue;
    }
    const allDayOccupancy = getTableBookingOccupancyById(
      bookings,
      source.booking
    );
    for (const target of destinations) {
      if (target.id === tableId) continue;
      const decoded = decodeTableCandidates([target]);
      if (
        Result.isSuccess(decoded) &&
        hasCandidateCapacity(decoded.success, allDayOccupancy)
      ) {
        return { source, targetTableId: target.id };
      }
    }
  }
};
