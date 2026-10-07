import { describe, expect, test } from "bun:test";
import {
  countReservationStatusPartitions,
  type ReservationStatus,
  type ReservationStatusCounts,
} from "./diagnostic-counts";
import { hashWorkspaceE2ECandidateIds } from "./source-candidate-set";

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

describe("workspace E2E candidate-set hash", () => {
  const candidateIds = Array.from(
    { length: 38 },
    (_, index) => `synthetic-reservation-${index}`
  );

  test("hashes a sorted unique candidate set deterministically", () => {
    expect(hashWorkspaceE2ECandidateIds(candidateIds)).toBe(
      hashWorkspaceE2ECandidateIds([...candidateIds].reverse())
    );
    expect(hashWorkspaceE2ECandidateIds(candidateIds)).toBe(
      hashWorkspaceE2ECandidateIds([...candidateIds, candidateIds[0]!])
    );
  });

  test("changes the hash when one ID is replaced without changing the count", () => {
    const replacement = [
      ...candidateIds.slice(0, -1),
      "synthetic-reservation-replacement",
    ];

    expect(replacement).toHaveLength(candidateIds.length);
    expect(hashWorkspaceE2ECandidateIds(replacement)).not.toBe(
      hashWorkspaceE2ECandidateIds(candidateIds)
    );
  });
});
