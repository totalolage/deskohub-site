/**
 * Table Selection Logic
 *
 * This module handles intelligent table assignment based on:
 * - Guest count
 * - Table preferences (standard, large, private, any)
 * - Table availability
 */

import type { Table } from "../generated/types.gen";

export interface TableSelectionInput {
  guestCount: number;
  needsLargerTable: boolean;
  needsPrivateSpace: boolean;
  availableTables: Table[];
}

export interface TableSelectionResult {
  selectedTableId: string;
  selectedTableName: string;
  seats: number;
  reason: string;
}

/**
 * Select the best table based on guest count and preferences
 */
export function selectBestTable(
  input: TableSelectionInput
): TableSelectionResult | null {
  const { guestCount, needsLargerTable, needsPrivateSpace, availableTables } =
    input;

  // Filter and convert seats to numbers
  const tables = availableTables
    .filter(
      (t) => t.enabled !== false && t.display !== false && t.id && t.seats
    )
    .map((t) => ({
      ...t,
      seatsNum:
        typeof t.seats === "string" ? parseInt(t.seats, 10) : t.seats || 0,
    }))
    .filter((t) => t.seatsNum > 0)
    .sort((a, b) => a.seatsNum - b.seatsNum); // Sort by capacity

  if (tables.length === 0) {
    return null;
  }

  const [privateTables, publicTables] = tables.reduce<
    [typeof tables, typeof tables]
  >(
    ([privateTables, publicTables], t) => {
      if (/dnd|private|vip|soukrom/i.test(t.name)) {
        privateTables.push(t);
      } else {
        publicTables.push(t);
      }
      return [privateTables, publicTables];
    },
    [[], []]
  );

  // Priority 1: Private space (only if ≤5 people)
  if (needsPrivateSpace && guestCount <= 5) {
    const privateTable = privateTables[0];
    if (privateTable) {
      return {
        selectedTableId: privateTable.id!,
        selectedTableName: privateTable.name,
        seats: privateTable.seatsNum,
        reason: "Selected private/DnD room",
      };
    }
  }

  // Priority 2: Larger table for board games
  if (needsLargerTable) {
    const largeTable = publicTables
      .filter((t) => t.seatsNum >= Math.max(7, guestCount))
      .shift(); // Get first (smallest) that fits

    if (largeTable) {
      return {
        selectedTableId: largeTable.id!,
        selectedTableName: largeTable.name,
        seats: largeTable.seatsNum,
        reason: `Selected large table (${largeTable.seatsNum} seats)`,
      };
    }
  }

  // Default: Smallest table that fits group
  const selectedTable =
    publicTables.find((t) => t.seatsNum >= guestCount) ||
    publicTables[tables.length - 1]; // Largest available

  if (!selectedTable || !selectedTable.id) {
    return null;
  }

  return {
    selectedTableId: selectedTable.id,
    selectedTableName: selectedTable.name,
    seats: selectedTable.seatsNum,
    reason:
      selectedTable.seatsNum >= guestCount
        ? `Selected table with ${selectedTable.seatsNum} seats`
        : "Selected largest available table",
  };
}

/**
 * Suggest table combinations for large groups
 */
export function suggestTableCombination(
  guestCount: number,
  availableTables: Table[]
): Table[][] {
  const tablesWithSeats = availableTables
    .filter((t) => t.enabled && t.display && t.seats)
    .map((t) => ({
      ...t,
      seatsNum: parseInt(String(t.seats || "0"), 10),
    }))
    .filter((t) => t.seatsNum > 0)
    .sort((a, b) => b.seatsNum - a.seatsNum);

  const combinations: Table[][] = [];
  let remainingGuests = guestCount;
  const selectedTables: Table[] = [];

  // Greedy algorithm: select largest tables first
  for (const table of tablesWithSeats) {
    if (remainingGuests <= 0) break;

    // Push the original table object, not the one with seatsNum
    const originalTable = availableTables.find((t) => t.id === table.id);
    if (originalTable) {
      selectedTables.push(originalTable);
      remainingGuests -= table.seatsNum;
    }

    if (remainingGuests <= 0) {
      combinations.push([...selectedTables]);
    }
  }

  return combinations;
}
