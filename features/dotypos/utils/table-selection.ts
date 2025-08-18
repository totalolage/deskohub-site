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
 *
 * Logic:
 * 1. If needsPrivateSpace: Select DnD room or private room (only for groups ≤5)
 * 2. If needsLargerTable: Select tables with 7+ seats
 * 3. Default: Select smallest table that seats group + 1
 */
export function selectBestTable(
  input: TableSelectionInput
): TableSelectionResult | null {
  const { guestCount, needsLargerTable, needsPrivateSpace, availableTables } =
    input;

  // Filter to only enabled and displayed tables
  const validTables = availableTables.filter(
    (t) => t.enabled !== false && t.display !== false && t.id && t.seats
  );

  if (validTables.length === 0) {
    return null;
  }

  // Parse seats to numbers for comparison
  const tablesWithSeats = validTables
    .filter(
      (t): t is typeof t & Required<Pick<Table, "seats">> => !!t.seats
    )
    .map(t => ({
      ...t,
      seatsNum: parseInt(t.seats, 10)
    }));

  let selectedTable: Table & { seatsNum: number } | undefined;
  let reason = "";

  // Priority 1: Private space (only if ≤5 people)
  if (needsPrivateSpace && guestCount <= 5) {
    // Look for DnD room or private room
    selectedTable = tablesWithSeats.find(
      (t) =>
        t.name.toLowerCase().includes("dnd") ||
        t.name.toLowerCase().includes("private") ||
        t.name.toLowerCase().includes("vip") ||
        t.name.toLowerCase().includes("soukrom")
    );

    if (selectedTable) {
      reason = "Selected private/DnD room as requested";
    } else {
      // Fallback to largest available table for some privacy
      selectedTable = tablesWithSeats
        .filter((t) => t.seatsNum >= guestCount)
        .sort((a, b) => b.seatsNum - a.seatsNum)[0];
      reason = "No private room available, selected largest suitable table";
    }
  }
  // Priority 2: Larger table for larger game
  else if (needsLargerTable) {
    // Select tables with 7+ seats
    const largeTables = tablesWithSeats.filter((t) => t.seatsNum >= 7);

    if (largeTables.length > 0) {
      // Find the smallest large table that still fits the group
      selectedTable = largeTables
        .filter((t) => t.seatsNum >= guestCount)
        .sort((a, b) => a.seatsNum - b.seatsNum)[0];

      if (!selectedTable) {
        // If no large table fits, get the largest available
        selectedTable = largeTables.sort((a, b) => b.seatsNum - a.seatsNum)[0];
        reason =
          "Selected largest available table (may need additional seating)";
      } else {
        reason = `Selected large table with ${selectedTable.seatsNum} seats for game`;
      }
    } else {
      // No large tables, fallback to best fit
      selectedTable = findBestFitTable(tablesWithSeats, guestCount + 1);
      reason = "No large tables available, selected best fit";
    }
  }
  // Default: Smallest table that fits group + 1
  else {
    // Find smallest table that seats group + 1 (for game space)
    const targetSize = guestCount + 1;

    // First try exact match or slightly larger
    selectedTable = tablesWithSeats
      .filter((t) => t.seatsNum >= targetSize)
      .sort((a, b) => a.seatsNum - b.seatsNum)[0];

    if (selectedTable) {
      reason = `Selected table with ${selectedTable.seatsNum} seats (group + game space)`;
    } else {
      // If no table fits group + 1, get best fit for group size
      selectedTable = findBestFitTable(tablesWithSeats, guestCount);
      reason = selectedTable
        ? `Selected best available table with ${selectedTable.seatsNum} seats`
        : "Selected available table";
    }
  }

  // If no table selected yet, fallback to any table that fits
  if (!selectedTable) {
    selectedTable = tablesWithSeats
      .filter((t) => t.seatsNum >= guestCount)
      .sort((a, b) => a.seatsNum - b.seatsNum)[0];

    if (!selectedTable) {
      // Last resort: biggest table available
      selectedTable = tablesWithSeats.sort((a, b) => b.seatsNum - a.seatsNum)[0];
      reason = "Selected largest available table (group may need to split)";
    }
  }

  if (!selectedTable || !selectedTable.id) {
    return null;
  }

  return {
    selectedTableId: selectedTable.id,
    selectedTableName: selectedTable.name,
    seats: selectedTable.seatsNum,
    reason,
  };
}

/**
 * Find the best fitting table for a guest count
 * Prefers exact match, then slightly larger, then any that fits
 */
function findBestFitTable(
  tables: Array<{ seatsNum: number } & Table>,
  guestCount: number
): (typeof tables)[0] | undefined {
  // First try exact match
  let selected = tables.find((t) => t.seatsNum === guestCount);

  if (!selected) {
    // Try slightly larger (up to 2 extra seats)
    selected = tables
      .filter((t) => t.seatsNum >= guestCount && t.seatsNum <= guestCount + 2)
      .sort((a, b) => a.seatsNum - b.seatsNum)[0];
  }

  if (!selected) {
    // Any table that fits
    selected = tables
      .filter((t) => t.seatsNum >= guestCount)
      .sort((a, b) => a.seatsNum - b.seatsNum)[0];
  }

  if (!selected) {
    // Table too small but closest to needed size
    selected = tables.sort((a, b) => b.seatsNum - a.seatsNum)[0];
  }

  return selected;
}

/**
 * Check if multiple tables are needed for a group
 */
export function needsMultipleTables(
  guestCount: number,
  availableTables: Table[]
): boolean {
  const maxSeats = Math.max(
    ...availableTables
      .filter((t) => t.seats)
      .map((t) =>
        typeof t.seats === "number" ? t.seats : parseInt(String(t.seats || "0"))
      )
  );

  return guestCount > maxSeats;
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
      seatsNum: parseInt(String(t.seats || "0")),
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
    const originalTable = availableTables.find(t => t.id === table.id);
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
