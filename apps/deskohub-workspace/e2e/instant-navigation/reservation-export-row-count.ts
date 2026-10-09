/**
 * Parity evidence for the admin reservations Export CSV download against the
 * rendered reservation count badge. The preview database is shared with
 * mutating projects, so the count may legitimately change between the page
 * render and the export request; the verdict is exact parity when the count is
 * stable and an inclusive two-count bracket when it moved. Anything outside
 * the bracket, a negative row count, or a header-only CSV while both counts
 * are positive is failed evidence.
 */
export type ReservationExportRowCountVerdict =
  | {
      readonly ok: true;
      readonly evidence: "exact-parity" | "count-bracket";
    }
  | {
      readonly ok: false;
      readonly reason:
        | "negative-row-count"
        | "header-only-while-counts-positive"
        | "row-count-outside-count-bracket";
    };

export const evaluateReservationExportRowCount = (input: {
  readonly countBefore: number;
  readonly countAfter: number;
  readonly dataRowCount: number;
}): ReservationExportRowCountVerdict => {
  const { countBefore, countAfter, dataRowCount } = input;
  if (dataRowCount < 0) {
    return { ok: false, reason: "negative-row-count" };
  }
  if (countBefore > 0 && countAfter > 0 && dataRowCount === 0) {
    return { ok: false, reason: "header-only-while-counts-positive" };
  }
  const lowestCount = Math.min(countBefore, countAfter);
  const highestCount = Math.max(countBefore, countAfter);
  if (dataRowCount < lowestCount || dataRowCount > highestCount) {
    return { ok: false, reason: "row-count-outside-count-bracket" };
  }
  return countBefore === countAfter
    ? { ok: true, evidence: "exact-parity" }
    : { ok: true, evidence: "count-bracket" };
};
