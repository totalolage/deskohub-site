import { describe, expect, test } from "bun:test";
import { evaluateReservationExportRowCount } from "./reservation-export-row-count";

describe("reservation export row count verdict", () => {
  test("requires exact parity when the rendered count is stable", () => {
    expect(
      evaluateReservationExportRowCount({
        countBefore: 7,
        countAfter: 7,
        dataRowCount: 7,
      })
    ).toEqual({ ok: true, evidence: "exact-parity" });
    expect(
      evaluateReservationExportRowCount({
        countBefore: 7,
        countAfter: 7,
        dataRowCount: 8,
      })
    ).toEqual({ ok: false, reason: "row-count-outside-count-bracket" });
  });

  test("accepts only the inclusive bracket when the count moved", () => {
    expect(
      evaluateReservationExportRowCount({
        countBefore: 10,
        countAfter: 12,
        dataRowCount: 11,
      })
    ).toEqual({ ok: true, evidence: "count-bracket" });
    expect(
      evaluateReservationExportRowCount({
        countBefore: 12,
        countAfter: 10,
        dataRowCount: 10,
      })
    ).toEqual({ ok: true, evidence: "count-bracket" });
    expect(
      evaluateReservationExportRowCount({
        countBefore: 10,
        countAfter: 12,
        dataRowCount: 13,
      })
    ).toEqual({ ok: false, reason: "row-count-outside-count-bracket" });
    expect(
      evaluateReservationExportRowCount({
        countBefore: 10,
        countAfter: 12,
        dataRowCount: 9,
      })
    ).toEqual({ ok: false, reason: "row-count-outside-count-bracket" });
  });

  test("fails a header-only CSV while both counts are positive", () => {
    expect(
      evaluateReservationExportRowCount({
        countBefore: 5,
        countAfter: 6,
        dataRowCount: 0,
      })
    ).toEqual({ ok: false, reason: "header-only-while-counts-positive" });
  });

  test("allows an empty export only when the counts agree on zero", () => {
    expect(
      evaluateReservationExportRowCount({
        countBefore: 0,
        countAfter: 0,
        dataRowCount: 0,
      })
    ).toEqual({ ok: true, evidence: "exact-parity" });
  });

  test("fails negative row counts", () => {
    expect(
      evaluateReservationExportRowCount({
        countBefore: 5,
        countAfter: 5,
        dataRowCount: -1,
      })
    ).toEqual({ ok: false, reason: "negative-row-count" });
  });
});
