import { describe, expect, test } from "bun:test";
import {
  countReservationStatusPartitions,
  type ReservationStatus,
  type ReservationStatusCounts,
} from "./diagnostic-counts";

const emptyCounts = (): ReservationStatusCounts => ({
  CANCELLED: 0,
  CONFIRMED: 0,
  NEW: 0,
});

const sumCounts = (...counts: readonly ReservationStatusCounts[]) => {
  const totals = emptyCounts();
  for (const item of counts) {
    for (const status of ["CANCELLED", "CONFIRMED", "NEW"] as const) {
      totals[status] += item[status];
    }
  }
  return totals;
};

describe("reservation diagnostic count partitions", () => {
  test.each([
    {
      scenario: "confirmed source marker",
      active: { CANCELLED: [], CONFIRMED: ["marker"], NEW: [] },
      candidates: { marker: "CONFIRMED", other: "CANCELLED" },
      marker: "marker",
      expectedActive: {
        sourceMarkers: { CANCELLED: 0, CONFIRMED: 1, NEW: 0 },
        otherCandidates: { CANCELLED: 0, CONFIRMED: 0, NEW: 0 },
      },
      expectedCandidates: {
        sourceMarkers: { CANCELLED: 0, CONFIRMED: 1, NEW: 0 },
        otherCandidates: { CANCELLED: 1, CONFIRMED: 0, NEW: 0 },
      },
      expectedActiveTotal: { CANCELLED: 0, CONFIRMED: 1, NEW: 0 },
      expectedCandidateTotal: { CANCELLED: 1, CONFIRMED: 1, NEW: 0 },
    },
    {
      scenario: "confirmed non-marker candidate",
      active: { CANCELLED: [], CONFIRMED: ["other"], NEW: [] },
      candidates: { marker: "CANCELLED", other: "CONFIRMED" },
      marker: "marker",
      expectedActive: {
        sourceMarkers: { CANCELLED: 0, CONFIRMED: 0, NEW: 0 },
        otherCandidates: { CANCELLED: 0, CONFIRMED: 1, NEW: 0 },
      },
      expectedCandidates: {
        sourceMarkers: { CANCELLED: 1, CONFIRMED: 0, NEW: 0 },
        otherCandidates: { CANCELLED: 0, CONFIRMED: 1, NEW: 0 },
      },
      expectedActiveTotal: { CANCELLED: 0, CONFIRMED: 1, NEW: 0 },
      expectedCandidateTotal: { CANCELLED: 1, CONFIRMED: 1, NEW: 0 },
    },
  ] as const)(
    "$scenario preserves aggregate counts",
    ({
      active,
      candidates,
      marker,
      expectedActive,
      expectedCandidates,
      expectedActiveTotal,
      expectedCandidateTotal,
    }) => {
      const activeIdsByStatus = {
        CANCELLED: new Set(active.CANCELLED),
        CONFIRMED: new Set(active.CONFIRMED),
        NEW: new Set(active.NEW),
      } satisfies Record<ReservationStatus, ReadonlySet<string>>;
      const result = countReservationStatusPartitions(
        new Map(Object.entries(candidates)) as Map<string, ReservationStatus>,
        new Set([marker]),
        activeIdsByStatus
      );

      expect(result).toEqual({
        activeInventoryIntersectionPartitions: expectedActive,
        candidateStatusPartitions: expectedCandidates,
      });
      expect(
        sumCounts(
          result.activeInventoryIntersectionPartitions.sourceMarkers,
          result.activeInventoryIntersectionPartitions.otherCandidates
        )
      ).toEqual(expectedActiveTotal);
      expect(
        sumCounts(
          result.candidateStatusPartitions.sourceMarkers,
          result.candidateStatusPartitions.otherCandidates
        )
      ).toEqual(expectedCandidateTotal);
    }
  );
});
