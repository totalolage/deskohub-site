import { ValidationError } from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
import { Effect, Schema } from "effect";
import { workspaceCoworkTiers } from "@/features/checkout/product-catalog";
import { getAssignableDotyposTableId } from "./dotypos-table-id";
import { workspaceBookingSeatCount } from "./workspace-table-occupancy";

export const workspaceMeetingRoomReservationTableTag =
  "reservation:meeting-room";
export const workspaceOfficeReservationTableTag = "reservation:office";

const fallbackRoomKey = "__workspace-table-selection:fallback-room__";

const tableNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

const workspaceTableSeatCapacitySchema = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
).annotate({
  identifier: "WorkspaceTableSeatCapacity",
  description: "Positive integer seat capacity configured on a Dotypos table.",
});

interface WorkspaceTableCandidate {
  readonly table: Table;
  readonly seatCapacity: number;
}

const compareWorkspaceTables = (left: Table, right: Table) => {
  const nameComparison = tableNameCollator.compare(left.name, right.name);

  if (nameComparison !== 0) return nameComparison;

  return (left.id ?? "").localeCompare(right.id ?? "");
};

export const getWorkspaceTableCandidates = (
  tables: readonly Table[],
  requiredTags: readonly string[]
) => tables.filter((table) => isAssignableWorkspaceTable(table, requiredTags));

export const getWorkspaceTableSeatCapacity = Effect.fn(
  "WorkspaceTable.getSeatCapacity"
)((table: Table) =>
  Schema.decodeUnknownEffect(workspaceTableSeatCapacitySchema)(
    table.seats
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ValidationError({
          message: `Dotypos workspace table ${table.id ?? table.name} has an invalid seat capacity.`,
          cause,
        })
    )
  )
);

export const hasAvailableWorkspaceTableCandidate = (
  tables: readonly Table[],
  requiredTags: readonly string[],
  occupancyByTableId: ReadonlyMap<string, number>,
  seats = workspaceBookingSeatCount,
  requireEmpty = false
) =>
  decodeWorkspaceTableCandidates(
    getWorkspaceTableCandidates(tables, requiredTags)
  ).pipe(
    Effect.map((candidates) =>
      candidates.some((candidate) =>
        hasWorkspaceTableCapacity(
          candidate,
          occupancyByTableId,
          seats,
          requireEmpty
        )
      )
    )
  );

export const selectWorkspaceTableFromCandidates = (
  candidates: readonly Table[],
  allTables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>,
  seats = workspaceBookingSeatCount,
  requireEmpty = false
) =>
  decodeWorkspaceTableCandidates(candidates).pipe(
    Effect.map((decodedCandidates) =>
      selectDecodedWorkspaceTableFromCandidates(
        decodedCandidates,
        allTables,
        occupancyByTableId,
        seats,
        requireEmpty
      )
    )
  );

const selectDecodedWorkspaceTableFromCandidates = (
  candidates: readonly WorkspaceTableCandidate[],
  allTables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>,
  seats: number,
  requireEmpty: boolean
) => {
  const scoringTablesByRoom = getWorkspaceScoringTablesByRoom(allTables);
  const maxDistanceByRoom =
    getWorkspaceTableMaxDistanceByRoom(scoringTablesByRoom);
  let selectedTable: Table | undefined;
  let selectedScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const { table } = candidate;
    if (
      !hasWorkspaceTableCapacity(
        candidate,
        occupancyByTableId,
        seats,
        requireEmpty
      )
    ) {
      continue;
    }

    const score = scoreWorkspaceTableCandidate(
      table,
      scoringTablesByRoom.get(getWorkspaceTableRoomKey(table)) ?? [],
      maxDistanceByRoom.get(getWorkspaceTableRoomKey(table)) ?? 0,
      occupancyByTableId
    );
    const scoreComparison = score - selectedScore;

    if (
      !selectedTable ||
      scoreComparison > 0 ||
      (scoreComparison === 0 &&
        compareWorkspaceTables(table, selectedTable) < 0)
    ) {
      selectedTable = table;
      selectedScore = score;
    }
  }

  return selectedTable;
};

const decodeWorkspaceTableCandidates = (tables: readonly Table[]) =>
  Effect.forEach(tables, (table) =>
    getWorkspaceTableSeatCapacity(table).pipe(
      Effect.map((seatCapacity) => ({ table, seatCapacity }))
    )
  );

const isAssignableWorkspaceTable = (
  table: Table,
  requiredTags: readonly string[]
) => {
  const tableId = getAssignableDotyposTableId(table);
  if (!tableId) return false;
  if (table.enabled !== true || table.display !== true) return false;

  const tableTags = new Set(table.tags ?? []);
  return requiredTags.every((tag) => tableTags.has(tag));
};

const hasWorkspaceTableCapacity = (
  candidate: WorkspaceTableCandidate,
  occupancyByTableId: ReadonlyMap<string, number>,
  seats: number,
  requireEmpty: boolean
) => {
  const { seatCapacity: capacity, table } = candidate;
  const tableId = getAssignableDotyposTableId(table);
  if (!tableId) return false;
  const occupancy = occupancyByTableId.get(tableId) ?? 0;

  if (requireEmpty) return occupancy === 0 && seats <= capacity;

  // Workspace bookings are assigned as whole parties to one table. Splitting a
  // party across multiple tables would need separate assignment logic later.
  return occupancy + seats <= capacity;
};

const scoreWorkspaceTableCandidate = (
  candidate: Table,
  scoringTables: readonly Table[],
  maxDistance: number,
  occupancyByTableId: ReadonlyMap<string, number>
) => {
  const candidateTableId = getAssignableDotyposTableId(candidate);
  const candidateOccupancy = candidateTableId
    ? (occupancyByTableId.get(candidateTableId) ?? 0)
    : 0;
  let occupiedSeats = 0;
  let weightedDistanceScore = 0;

  for (const table of scoringTables) {
    const tableId = getAssignableDotyposTableId(table);
    const occupancy = tableId ? (occupancyByTableId.get(tableId) ?? 0) : 0;
    if (occupancy <= 0) continue;

    const normalizedDistance =
      maxDistance === 0
        ? 0
        : getWorkspaceTableDistance(table, candidate) / maxDistance;

    occupiedSeats += occupancy;
    weightedDistanceScore += occupancy * normalizedDistance ** 2;
  }

  const distanceScore =
    occupiedSeats === 0 ? 0 : weightedDistanceScore / occupiedSeats;

  return distanceScore - 2 * candidateOccupancy ** 2;
};

const getWorkspaceScoringTablesByRoom = (tables: readonly Table[]) => {
  const scoringTablesByRoom = new Map<string, Table[]>();

  for (const table of tables) {
    if (!isDisplayableWorkspaceTable(table)) continue;

    const roomKey = getWorkspaceTableRoomKey(table);
    const roomTables = scoringTablesByRoom.get(roomKey);
    if (roomTables) {
      roomTables.push(table);
    } else {
      scoringTablesByRoom.set(roomKey, [table]);
    }
  }

  return scoringTablesByRoom;
};

export const isDisplayableWorkspaceTable = (table: Table) => {
  const tableId = getAssignableDotyposTableId(table);
  if (!tableId) return false;
  if (table.enabled !== true || table.display !== true) return false;

  const tableTags = new Set(table.tags ?? []);
  return (
    workspaceCoworkTiers.some((tier) => tableTags.has(`tier:${tier}`)) ||
    tableTags.has(workspaceMeetingRoomReservationTableTag) ||
    tableTags.has(workspaceOfficeReservationTableTag)
  );
};

const getWorkspaceTableRoomKey = (table: Table) =>
  table.locationName ?? fallbackRoomKey;

const getWorkspaceTableMaxDistanceByRoom = (
  scoringTablesByRoom: ReadonlyMap<string, readonly Table[]>
) => {
  const maxDistanceByRoom = new Map<string, number>();

  for (const [roomKey, tables] of scoringTablesByRoom) {
    maxDistanceByRoom.set(roomKey, getWorkspaceTableMaxDistance(tables));
  }

  return maxDistanceByRoom;
};

const getWorkspaceTableDistance = (left: Table, right: Table) =>
  Math.hypot(
    parseCoordinate(left.positionX) - parseCoordinate(right.positionX),
    parseCoordinate(left.positionY) - parseCoordinate(right.positionY)
  );

const getWorkspaceTableMaxDistance = (tables: readonly Table[]) => {
  let maxDistance = 0;

  for (const left of tables) {
    for (const right of tables) {
      maxDistance = Math.max(
        maxDistance,
        getWorkspaceTableDistance(left, right)
      );
    }
  }

  return maxDistance;
};

const parseCoordinate = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
