import type { DotyposReservation } from "@deskohub/dotypos";

/**
 * The Dotypos reservation fields Workspace reads to show, place, and check a
 * reservation: no customer link and no free-text note, so it can be shared
 * across requests.
 */
export type ReservationRecord = Pick<
  DotyposReservation,
  "id" | "status" | "_tableId" | "startDate" | "endDate" | "seats"
>;

/** Drops customer links and free-text notes before sharing a reservation. */
export const toReservationRecord = ({
  id,
  status,
  _tableId,
  startDate,
  endDate,
  seats,
}: ReservationRecord): ReservationRecord => ({
  ...(id !== undefined && { id }),
  status,
  ...(_tableId !== undefined && { _tableId }),
  startDate,
  endDate,
  seats,
});
