export type UnnormalizedLogicalExpression<T> =
  | T
  | UnnormalizedLogicalExpression<T>[];

export type CnfExpression<T> = readonly (readonly T[])[];

/**
 * Recursively flatten an expression to extract all strings
 */
function flattenToStrings<T extends string>(
  expr: UnnormalizedLogicalExpression<T>
): T[] {
  if (Array.isArray(expr)) {
    const result: T[] = [];
    for (const item of expr) {
      result.push(...flattenToStrings(item));
    }
    return result;
  }

  // Convert any other type to string
  return [expr];
}

/**
 * Normalizes a tag expression to Conjunctive Normal Form (CNF)
 * CNF format: string[][] where:
 * - Inner arrays represent AND conditions (sorted alphabetically)
 * - Outer array represents OR conditions (sorted by serialized group)
 *
 * Sorting ensures consistent cache keys regardless of input order.
 *
 * Examples:
 * - "tag1" -> [["tag1"]]
 * - ["tag2", "tag1"] -> [["tag1"], ["tag2"]] (sorted)
 * - [["tag2", "tag1"]] -> [["tag1", "tag2"]] (inner sorted)
 * - ["tag1", ["tag3", "tag2"]] -> [["tag1"], ["tag2", "tag3"]] (all sorted)
 */
export function normalizeExpression<T extends string>(
  expression: UnnormalizedLogicalExpression<T>
): T[][] {
  // Handle single string
  if (typeof expression === "string") {
    return [[expression]];
  }

  // Process array elements
  const cnf: T[][] = [];

  for (const item of expression) {
    // Extract all strings from this item (handles any depth of nesting)
    const strings = flattenToStrings(item);

    // Skip empty groups
    if (strings.length === 0) {
      continue;
    }

    cnf.push(flattenToStrings<T>(item));
  }

  // Filter out empty groups and sort
  return sortCnf(cnf.filter((group) => group.length > 0));
}

function sortCnf<T extends string>(cnf: T[][]): T[][] {
  return cnf
    .map((group) => group.sort()) // Sort each AND group alphabetically
    .sort((a, b) => {
      // Sort OR groups by their serialized representation
      const aStr = a.join(",");
      const bStr = b.join(",");
      return aStr.localeCompare(bStr);
    });
}
