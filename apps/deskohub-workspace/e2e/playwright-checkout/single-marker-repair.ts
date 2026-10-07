import { hashWorkspaceE2ECandidateIds } from "./source-candidate-set";

export const expectedSingleMarkerRepairCandidateCount = 38;
export const expectedSingleMarkerRepairSourceMarkerCount = 36;

export const singleMarkerRepairReservationStatuses = [
  "CANCELLED",
  "CONFIRMED",
  "NEW",
] as const;

export type SingleMarkerRepairReservationStatus =
  (typeof singleMarkerRepairReservationStatuses)[number];

export type SingleMarkerRepairSourceMarker = {
  readonly caseId: string;
  readonly expectedEmail: string;
  readonly orderId: string | undefined;
  readonly reservationId: string;
};

export type SingleMarkerRepairSourceOwnership = {
  readonly marker: SingleMarkerRepairSourceMarker;
  readonly checkoutRow:
    | {
        readonly customerId: string | null;
        readonly orderId: string;
        readonly reservationId: string | null;
      }
    | undefined;
  readonly reservation:
    | {
        readonly customerEmail: string | null;
        readonly customerId: string | null;
        readonly reservationId: string;
      }
    | undefined;
  readonly customer:
    | {
        readonly customerId: string;
        readonly email: string | null;
      }
    | undefined;
};

export type SingleMarkerRepairPlan = {
  readonly target: SingleMarkerRepairSourceMarker;
  readonly candidateCount: number;
  readonly sourceMarkerCount: number;
  readonly cancelledBeforeRepair: number;
  readonly confirmedBeforeRepair: number;
  readonly activeBeforeRepair: number;
};

export const prepareSingleMarkerRepairPlan = (input: {
  readonly sourceMarkers: readonly SingleMarkerRepairSourceMarker[];
  readonly candidateIds: readonly string[];
  readonly expectedCandidateSetSha256: string;
  readonly statusByCandidateId: ReadonlyMap<string, string>;
  readonly activeInventory: readonly {
    readonly reservationId: string;
    readonly status: string;
  }[];
}): SingleMarkerRepairPlan => {
  const markerIds = input.sourceMarkers.map(
    ({ reservationId }) => reservationId
  );
  const candidateIdSet = new Set(input.candidateIds);
  const markerIdSet = new Set(markerIds);
  if (
    !/^[0-9a-f]{64}$/.test(input.expectedCandidateSetSha256) ||
    hashWorkspaceE2ECandidateIds(input.candidateIds) !==
      input.expectedCandidateSetSha256
  ) {
    throw new Error("single_marker_repair_candidate_set_mismatch");
  }
  const activeCandidateIds = input.activeInventory.map(
    ({ reservationId }) => reservationId
  );
  const activeCandidateIdSet = new Set(activeCandidateIds);

  if (
    input.sourceMarkers.length !==
      expectedSingleMarkerRepairSourceMarkerCount ||
    markerIdSet.size !== expectedSingleMarkerRepairSourceMarkerCount ||
    input.candidateIds.length !== expectedSingleMarkerRepairCandidateCount ||
    candidateIdSet.size !== expectedSingleMarkerRepairCandidateCount ||
    [...markerIdSet].some((id) => !candidateIdSet.has(id)) ||
    input.statusByCandidateId.size !==
      expectedSingleMarkerRepairCandidateCount ||
    [...candidateIdSet].some((id) => !input.statusByCandidateId.has(id)) ||
    [...input.statusByCandidateId.keys()].some(
      (id) => !candidateIdSet.has(id)
    ) ||
    activeCandidateIds.length !== activeCandidateIdSet.size ||
    [...activeCandidateIdSet].some((id) => !candidateIdSet.has(id))
  ) {
    throw new Error("single_marker_repair_preflight_invalid");
  }

  const statusById = input.statusByCandidateId;
  const statuses = [...statusById.values()];
  if (
    statuses.some(
      (status) =>
        !singleMarkerRepairReservationStatuses.some(
          (allowedStatus) => allowedStatus === status
        )
    )
  ) {
    throw new Error("single_marker_repair_status_unknown");
  }
  if (
    input.activeInventory.some(
      ({ status }) =>
        !singleMarkerRepairReservationStatuses.some(
          (allowedStatus) => allowedStatus === status
        )
    )
  ) {
    throw new Error("single_marker_repair_inventory_status_unknown");
  }

  const confirmedIds = [...statusById].flatMap(([id, status]) =>
    status === "CONFIRMED" ? [id] : []
  );
  const cancelledCount = statuses.filter(
    (status) => status === "CANCELLED"
  ).length;
  const newCount = statuses.filter((status) => status === "NEW").length;
  const targetId = confirmedIds[0];
  const target = input.sourceMarkers.find(
    ({ reservationId }) => reservationId === targetId
  );
  const activeTarget = input.activeInventory.find(
    ({ reservationId }) => reservationId === targetId
  );

  if (
    confirmedIds.length !== 1 ||
    cancelledCount !== expectedSingleMarkerRepairCandidateCount - 1 ||
    newCount !== 0 ||
    !target ||
    activeCandidateIdSet.size !== 1 ||
    !activeCandidateIdSet.has(target.reservationId) ||
    activeTarget?.status !== "CONFIRMED"
  ) {
    throw new Error("single_marker_repair_preflight_invalid");
  }

  return {
    target,
    candidateCount: expectedSingleMarkerRepairCandidateCount,
    sourceMarkerCount: expectedSingleMarkerRepairSourceMarkerCount,
    cancelledBeforeRepair: cancelledCount,
    confirmedBeforeRepair: confirmedIds.length,
    activeBeforeRepair: activeCandidateIdSet.size,
  };
};

export const assertSingleMarkerRepairSourceOwnership = (
  input: SingleMarkerRepairSourceOwnership
): void => {
  const { checkoutRow, customer, marker, reservation } = input;
  if (
    !marker.orderId ||
    !checkoutRow ||
    checkoutRow.orderId !== marker.orderId ||
    checkoutRow.reservationId !== marker.reservationId ||
    !checkoutRow.customerId ||
    !reservation ||
    reservation.reservationId !== marker.reservationId ||
    reservation.customerId !== checkoutRow.customerId ||
    reservation.customerEmail !== marker.expectedEmail ||
    !customer ||
    customer.customerId !== checkoutRow.customerId ||
    customer.email !== marker.expectedEmail
  ) {
    throw new Error("single_marker_repair_source_ownership_invalid");
  }
};

export const runSingleMarkerRepair = async <A>(input: {
  readonly plan: SingleMarkerRepairPlan;
  readonly candidateIds: readonly string[];
  readonly assertTargetOwnership: (
    marker: SingleMarkerRepairSourceMarker
  ) => Promise<void>;
  readonly cancelTarget: (
    marker: SingleMarkerRepairSourceMarker
  ) => Promise<void>;
  readonly convergeAllCandidates: (
    candidateIds: readonly string[]
  ) => Promise<void>;
  readonly reconcileAccountLane: () => Promise<void>;
  readonly assertAccountPostconditions: () => Promise<A>;
}): Promise<{
  readonly cancelledReservationCount: 1;
  readonly skippedCancelledCandidateCount: 37;
  readonly accountPostconditions: A;
}> => {
  await input.assertTargetOwnership(input.plan.target);
  await input.cancelTarget(input.plan.target);
  await input.convergeAllCandidates(input.candidateIds);
  await input.reconcileAccountLane();
  const accountPostconditions = await input.assertAccountPostconditions();
  return {
    accountPostconditions,
    cancelledReservationCount: 1,
    skippedCancelledCandidateCount: 37,
  };
};

export type SingleMarkerRepairAccountJournalIdentity = {
  readonly authUserIds: readonly string[];
  readonly completed: boolean;
  readonly dotyposCustomerIds: readonly string[];
  readonly dotyposReservationIds: readonly string[];
};

export const assertSingleMarkerRepairAccountPostconditions = (input: {
  readonly originalJournal: SingleMarkerRepairAccountJournalIdentity;
  readonly completedJournal: SingleMarkerRepairAccountJournalIdentity;
  readonly remainingAuthUsers: number;
  readonly remainingAuthSessions: number;
  readonly remainingAuthAccounts: number;
  readonly remainingCustomerLinks: number;
  readonly expiredRetainedCustomers: number;
}): void => {
  const sameIds = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length &&
    left.every((id, index) => id === right[index]);
  if (
    !input.completedJournal.completed ||
    !sameIds(
      input.originalJournal.authUserIds,
      input.completedJournal.authUserIds
    ) ||
    !sameIds(
      input.originalJournal.dotyposCustomerIds,
      input.completedJournal.dotyposCustomerIds
    ) ||
    !sameIds(
      input.originalJournal.dotyposReservationIds,
      input.completedJournal.dotyposReservationIds
    ) ||
    input.remainingAuthUsers !== 0 ||
    input.remainingAuthSessions !== 0 ||
    input.remainingAuthAccounts !== 0 ||
    input.remainingCustomerLinks !== 0 ||
    input.expiredRetainedCustomers !==
      input.originalJournal.dotyposCustomerIds.length
  ) {
    throw new Error("single_marker_repair_account_postconditions_failed");
  }
};
