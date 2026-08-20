import {
  type DotyposTable,
  type DotyposTableId,
  ValidationError,
} from "@deskohub/dotypos";
import { Effect, Match, Schema } from "effect";
import { workspaceCoworkTiers } from "@/features/checkout/product-catalog";
import {
  type WorkspaceReservationKind,
  workspaceReservationKindSchema,
} from "@/features/reservation/reservation-kind";
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
  readonly table: DotyposTable;
  readonly seatCapacity: number;
}

const compareWorkspaceTables = (left: DotyposTable, right: DotyposTable) => {
  const nameComparison = tableNameCollator.compare(left.name, right.name);

  if (nameComparison !== 0) return nameComparison;

  return (left.id ?? "").localeCompare(right.id ?? "");
};

export const getWorkspaceTableCandidates = (
  tables: readonly DotyposTable[],
  requiredTags: readonly string[]
) => tables.filter((table) => isAssignableWorkspaceTable(table, requiredTags));

export const getWorkspaceTableSeatCapacity = Effect.fn(
  "WorkspaceTable.getSeatCapacity"
)((table: DotyposTable) =>
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
  tables: readonly DotyposTable[],
  requiredTags: readonly string[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>,
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
  candidates: readonly DotyposTable[],
  allTables: readonly DotyposTable[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>,
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
  allTables: readonly DotyposTable[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>,
  seats: number,
  requireEmpty: boolean
) => {
  const scoringTablesByRoom = getWorkspaceScoringTablesByRoom(allTables);
  const maxDistanceByRoom =
    getWorkspaceTableMaxDistanceByRoom(scoringTablesByRoom);
  let selectedTable: DotyposTable | undefined;
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

const decodeWorkspaceTableCandidates = (tables: readonly DotyposTable[]) =>
  Effect.forEach(tables, (table) =>
    getWorkspaceTableSeatCapacity(table).pipe(
      Effect.map((seatCapacity) => ({ table, seatCapacity }))
    )
  );

const isAssignableWorkspaceTable = (
  table: DotyposTable,
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
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>,
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
  candidate: DotyposTable,
  scoringTables: readonly DotyposTable[],
  maxDistance: number,
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>
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

const getWorkspaceScoringTablesByRoom = (tables: readonly DotyposTable[]) => {
  const scoringTablesByRoom = new Map<string, DotyposTable[]>();

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

export const isDisplayableWorkspaceTable = (table: DotyposTable) => {
  const tableId = getAssignableDotyposTableId(table);
  if (!tableId) return false;
  if (table.enabled !== true || table.display !== true) return false;

  const tableTags = new Set(table.tags ?? []);
  return workspaceReservationKindSchema.literals.some((kind) =>
    hasWorkspaceReservationTableTag(tableTags, kind)
  );
};

const hasWorkspaceReservationTableTag = (
  tableTags: ReadonlySet<string>,
  kind: WorkspaceReservationKind
) =>
  Match.value({ kind }).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () =>
        workspaceCoworkTiers.some((tier) => tableTags.has(`tier:${tier}`)),
      "meeting-room": () =>
        tableTags.has(workspaceMeetingRoomReservationTableTag),
      office: () => tableTags.has(workspaceOfficeReservationTableTag),
    })
  );

const getWorkspaceTableRoomKey = (table: DotyposTable) =>
  table.locationName ?? fallbackRoomKey;

const getWorkspaceTableMaxDistanceByRoom = (
  scoringTablesByRoom: ReadonlyMap<string, readonly DotyposTable[]>
) => {
  const maxDistanceByRoom = new Map<string, number>();

  for (const [roomKey, tables] of scoringTablesByRoom) {
    maxDistanceByRoom.set(roomKey, getWorkspaceTableMaxDistance(tables));
  }

  return maxDistanceByRoom;
};

const getWorkspaceTableDistance = (left: DotyposTable, right: DotyposTable) =>
  Math.hypot(
    parseCoordinate(left.positionX) - parseCoordinate(right.positionX),
    parseCoordinate(left.positionY) - parseCoordinate(right.positionY)
  );

const getWorkspaceTableMaxDistance = (tables: readonly DotyposTable[]) => {
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
