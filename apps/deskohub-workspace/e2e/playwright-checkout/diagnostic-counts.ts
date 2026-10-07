export const reservationStatuses = ["CANCELLED", "CONFIRMED", "NEW"] as const;

export type ReservationStatus = (typeof reservationStatuses)[number];

export type ReservationStatusCounts = Record<ReservationStatus, number>;

export type ReservationStatusPartitions = {
  readonly sourceMarkers: ReservationStatusCounts;
  readonly otherCandidates: ReservationStatusCounts;
};

const emptyCounts = (): ReservationStatusCounts => ({
  CANCELLED: 0,
  CONFIRMED: 0,
  NEW: 0,
});

export const countReservationStatusPartitions = (
  statusByCandidateId: ReadonlyMap<string, ReservationStatus>,
  sourceMarkerIds: ReadonlySet<string>,
  activeIdsByStatus: Readonly<Record<ReservationStatus, ReadonlySet<string>>>
) => {
  const candidateStatusPartitions: ReservationStatusPartitions = {
    sourceMarkers: emptyCounts(),
    otherCandidates: emptyCounts(),
  };
  for (const [id, status] of statusByCandidateId) {
    const partition = sourceMarkerIds.has(id)
      ? candidateStatusPartitions.sourceMarkers
      : candidateStatusPartitions.otherCandidates;
    partition[status] += 1;
  }

  const activeInventoryIntersectionPartitions: ReservationStatusPartitions = {
    sourceMarkers: emptyCounts(),
    otherCandidates: emptyCounts(),
  };
  for (const status of reservationStatuses) {
    for (const id of activeIdsByStatus[status]) {
      const partition = sourceMarkerIds.has(id)
        ? activeInventoryIntersectionPartitions.sourceMarkers
        : activeInventoryIntersectionPartitions.otherCandidates;
      partition[status] += 1;
    }
  }

  return {
    activeInventoryIntersectionPartitions,
    candidateStatusPartitions,
  };
};
