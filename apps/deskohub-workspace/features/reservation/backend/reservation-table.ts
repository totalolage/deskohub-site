import type { DotyposTable } from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import {
  getWorkspaceTableCandidatesByPredicate,
  getWorkspaceTableSeatCapacity,
  isWorkspaceCoworkTableCandidate,
} from "@/features/checkout/backend/reservation";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { formatNamesWithNumericRanges } from "@/shared/utils/number";

export type CustomerReservationTable = {
  readonly mode: "assigned" | "shared";
  readonly name: string;
};

export const getCustomerReservationTable = (reservation: {
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly tableName?: string;
  readonly openSpaceTableNames?: readonly string[];
}): CustomerReservationTable | undefined => {
  if (
    reservation.reservationDetails.kind === "cowork" &&
    reservation.reservationDetails.entryTier === "open-space"
  ) {
    const name = formatNamesWithNumericRanges(
      reservation.openSpaceTableNames ?? []
    );

    return name ? { mode: "shared" as const, name } : undefined;
  }

  return reservation.tableName
    ? { mode: "assigned" as const, name: reservation.tableName }
    : undefined;
};

export const getReservationTableName = (
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

export const getOpenSpaceTableNames = (tables: readonly DotyposTable[]) =>
  Effect.forEach(
    getWorkspaceTableCandidatesByPredicate(tables, (tableTags) =>
      isWorkspaceCoworkTableCandidate(tableTags, { entryTier: "open-space" })
    ),
    (table) =>
      getWorkspaceTableSeatCapacity(table).pipe(
        Effect.as(table.name?.trim()),
        Effect.orElseSucceed(() => undefined)
      )
  ).pipe(
    Effect.map((names) => names.filter((name): name is string => Boolean(name)))
  );
