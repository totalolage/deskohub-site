import { DotyposReservationIdSchema } from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import type { WorkspaceE2EAccountLaneReconciliation } from "../account/reconcile";
import type { SingleMarkerRepairSourceMarker } from "./single-marker-repair";
import { hashWorkspaceE2ECandidateIds } from "./source-candidate-set";

export const singleMarkerRepairSourcePins = {
  candidateCount: 38,
  candidateSetSha256:
    "70628d48020610f47c9292bb5cbb6fd7eaac92ac5d77cdd1eec0eeafb5a7d55a",
  completedMarkerCount: 36,
  sourceArtifactFileCount: 36,
  sourceArtifactManifestSha256:
    "7736b918ac4c6a45675c997cbbf226e9dfd9e8047454bc9a492226f34b5e30e1",
  sourceRunId: "37580940745-1",
  sourceStateCount: 36,
} as const;

export const singleMarkerRepairSourceFailureReasons = [
  "account_preparation_failed",
  "account_lane_missing",
  "account_reservation_scope_invalid",
  "source_state_count_mismatch",
  "source_marker_count_mismatch",
  "source_marker_invalid",
  "checkout_cleanup_preparation_failed",
  "candidate_count_mismatch",
  "candidate_set_mismatch",
] as const;

export type SingleMarkerRepairSourceState = {
  readonly caseId: string;
  readonly state: {
    readonly completedDotyposReservationId?: string;
    readonly data: { readonly date: string; readonly email: string };
    readonly orderId?: string;
  };
};

export type SingleMarkerRepairCheckoutRow = {
  readonly reservation_id: string;
  readonly dotypos_customer_id: string | null;
  readonly dotypos_reservation_id: string | null;
};

export type SingleMarkerRepairSourceCheckoutPreparation = {
  readonly journalStates: readonly SingleMarkerRepairSourceState[];
  readonly checkoutRows: readonly SingleMarkerRepairCheckoutRow[];
  readonly orderRows: readonly (readonly [
    string,
    SingleMarkerRepairCheckoutRow | undefined,
  ])[];
};

export type SingleMarkerRepairSourceFailureReason =
  (typeof singleMarkerRepairSourceFailureReasons)[number];

export const singleMarkerRepairPreflightFailureReasons = [
  ...singleMarkerRepairSourceFailureReasons,
  "operation_pin_mismatch",
  "workflow_code_pin_mismatch",
  "source_context_mismatch",
  "source_preflight_failed",
] as const;

export type SingleMarkerRepairPreflightFailureReason =
  (typeof singleMarkerRepairPreflightFailureReasons)[number];

export type SingleMarkerRepairSourceCounts = {
  readonly accountLanePresent: boolean | null;
  readonly accountAuthCandidateCount: number | null;
  readonly accountCustomerCandidateCount: number | null;
  readonly accountReservationCandidateCount: number | null;
  readonly sourceStateCount: number;
  readonly completedMarkerCount: number;
  readonly invalidMarkerCount: number;
  readonly missingOrderIdCount: number;
  readonly uniqueOrderIdCount: number;
  readonly exactOrderRowReadCount: number;
  readonly exactOrderRowQueryFailureCount: number | null;
  readonly exactOrderRowMissingCount: number;
  readonly sourceMarkerRowReservationMismatchCount: number;
  readonly candidateCount: number;
  readonly candidateSetSha256: string | null;
};

export type PreparedSingleMarkerRepairSource = {
  readonly outcome: "ready";
  readonly counts: SingleMarkerRepairSourceCounts;
  readonly accountLane: WorkspaceE2EAccountLaneReconciliation;
  readonly journalStates: readonly SingleMarkerRepairSourceState[];
  readonly sourceMarkers: readonly SingleMarkerRepairSourceMarker[];
  readonly orderRows: readonly (readonly [
    string,
    SingleMarkerRepairCheckoutRow | undefined,
  ])[];
  readonly rowByOrderId: ReadonlyMap<
    string,
    SingleMarkerRepairCheckoutRow | undefined
  >;
  readonly candidateIds: readonly string[];
  readonly sourceMarkerIds: ReadonlySet<string>;
  readonly otherCandidateIds: ReadonlySet<string>;
  readonly candidateIdSetSha256: string;
  readonly sourceMarkerIdSetSha256: string;
  readonly otherCandidateIdSetSha256: string;
};

export type FailedSingleMarkerRepairSource = {
  readonly outcome: "failed";
  readonly reason: SingleMarkerRepairSourceFailureReason;
  readonly counts: SingleMarkerRepairSourceCounts;
};

export type SingleMarkerRepairSourcePreflight =
  | PreparedSingleMarkerRepairSource
  | FailedSingleMarkerRepairSource;

export type SingleMarkerRepairSourcePreflightReceipt = {
  readonly completedAt: string;
  readonly failureReason: SingleMarkerRepairPreflightFailureReason | null;
  readonly mutation: {
    readonly accountReconciliationStarted: false;
    readonly cancellationAttempted: false;
    readonly cancellationSucceeded: false;
  };
  readonly outcome: "source_preflight_failed" | "source_preflight_passed";
  readonly counts: SingleMarkerRepairSourceCounts;
  readonly source: {
    readonly artifactCleanupManifestSha256: string;
    readonly artifactFileCount: number;
    readonly codeRef: string;
    readonly codeSha: string;
    readonly executionRunAttempt: number;
    readonly executionRunId: string;
    readonly neonBranchIdSha256: string;
    readonly prNumber: number;
    readonly runId: string;
    readonly targetRef: string;
    readonly targetSha: string;
    readonly targetUrl: string;
  };
  readonly startedAt: string;
  readonly version: 1;
};

export const makeSingleMarkerRepairSourcePreflightReceipt = (input: {
  readonly preflight?: SingleMarkerRepairSourcePreflight;
  readonly failureReason?: SingleMarkerRepairPreflightFailureReason;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly source: SingleMarkerRepairSourcePreflightReceipt["source"];
}): SingleMarkerRepairSourcePreflightReceipt => {
  const preflight = input.preflight;
  const failed =
    input.failureReason !== undefined || preflight?.outcome === "failed";
  return {
    completedAt: input.completedAt,
    failureReason:
      input.failureReason ??
      (preflight?.outcome === "failed" ? preflight.reason : null),
    mutation: {
      accountReconciliationStarted: false,
      cancellationAttempted: false,
      cancellationSucceeded: false,
    },
    outcome: failed ? "source_preflight_failed" : "source_preflight_passed",
    counts: preflight?.counts ?? emptySingleMarkerRepairSourceCounts(),
    source: input.source,
    startedAt: input.startedAt,
    version: 1,
  };
};

export const emptySingleMarkerRepairSourceCounts =
  (): SingleMarkerRepairSourceCounts => ({
    accountLanePresent: null,
    accountAuthCandidateCount: null,
    accountCustomerCandidateCount: null,
    accountReservationCandidateCount: null,
    sourceStateCount: 0,
    completedMarkerCount: 0,
    invalidMarkerCount: 0,
    missingOrderIdCount: 0,
    uniqueOrderIdCount: 0,
    exactOrderRowReadCount: 0,
    exactOrderRowQueryFailureCount: null,
    exactOrderRowMissingCount: 0,
    sourceMarkerRowReservationMismatchCount: 0,
    candidateCount: 0,
    candidateSetSha256: null,
  });

const decodeReservationId = Schema.decodeUnknownOption(
  DotyposReservationIdSchema
);

export const prepareSingleMarkerRepairSource = async (input: {
  readonly readAccountLane: () => Promise<
    WorkspaceE2EAccountLaneReconciliation | undefined
  >;
  readonly readCheckoutCleanup: () => Promise<SingleMarkerRepairSourceCheckoutPreparation>;
  readonly expectedCandidateSetSha256?: string;
}): Promise<SingleMarkerRepairSourcePreflight> => {
  let counts = emptySingleMarkerRepairSourceCounts();
  const [accountResult, checkoutResult] = await Promise.all([
    input.readAccountLane().then(
      (accountLane) => ({ ok: true as const, accountLane }),
      () => ({ ok: false as const })
    ),
    input.readCheckoutCleanup().then(
      (checkoutCleanup) => ({ ok: true as const, checkoutCleanup }),
      () => ({ ok: false as const })
    ),
  ]);

  if (!accountResult.ok) {
    if (checkoutResult.ok) {
      counts = {
        ...counts,
        sourceStateCount: checkoutResult.checkoutCleanup.journalStates.length,
      };
    }
    return { outcome: "failed", reason: "account_preparation_failed", counts };
  }
  const accountLane = accountResult.accountLane;
  counts = {
    ...counts,
    accountLanePresent: accountLane !== undefined,
    accountAuthCandidateCount: accountLane?.authUserIds.length ?? 0,
    accountCustomerCandidateCount: accountLane?.dotyposCustomerIds.length ?? 0,
    accountReservationCandidateCount:
      accountLane?.dotyposReservationIds.length ?? 0,
  };
  if (!accountLane) {
    return { outcome: "failed", reason: "account_lane_missing", counts };
  }
  if (accountLane.journal.dotyposReservationIds.length !== 0) {
    return {
      outcome: "failed",
      reason: "account_reservation_scope_invalid",
      counts,
    };
  }
  if (!checkoutResult.ok) {
    return {
      outcome: "failed",
      reason: "checkout_cleanup_preparation_failed",
      counts,
    };
  }

  const { checkoutCleanup } = checkoutResult;
  const journalStates = checkoutCleanup.journalStates;
  counts = { ...counts, sourceStateCount: journalStates.length };
  if (journalStates.length !== singleMarkerRepairSourcePins.sourceStateCount) {
    return { outcome: "failed", reason: "source_state_count_mismatch", counts };
  }

  let invalidMarkerCount = 0;
  const sourceMarkers = journalStates.flatMap(({ caseId, state }) => {
    if (!state.completedDotyposReservationId) return [];
    const reservationId = Option.getOrUndefined(
      decodeReservationId(state.completedDotyposReservationId)
    );
    if (!reservationId) {
      invalidMarkerCount += 1;
      return [];
    }
    return [
      {
        caseId,
        expectedEmail: state.data.email,
        orderId: state.orderId,
        reservationId,
      },
    ];
  });
  counts = {
    ...counts,
    completedMarkerCount: journalStates.filter(({ state }) =>
      Boolean(state.completedDotyposReservationId)
    ).length,
    invalidMarkerCount,
  };
  if (invalidMarkerCount > 0) {
    return { outcome: "failed", reason: "source_marker_invalid", counts };
  }
  if (
    sourceMarkers.length !== singleMarkerRepairSourcePins.completedMarkerCount
  ) {
    return {
      outcome: "failed",
      reason: "source_marker_count_mismatch",
      counts,
    };
  }

  const allOrderIds = journalStates.flatMap(({ state }) =>
    state.orderId ? [state.orderId] : []
  );
  const orderIds = [...new Set(allOrderIds)];
  counts = {
    ...counts,
    missingOrderIdCount: journalStates.length - allOrderIds.length,
    uniqueOrderIdCount: orderIds.length,
  };

  const orderRows = checkoutCleanup.orderRows;
  const rowByOrderId = new Map(orderRows);
  let exactOrderRowMissingCount = 0;
  for (const [, row] of orderRows) if (!row) exactOrderRowMissingCount += 1;
  const sourceMarkerRowReservationMismatchCount = sourceMarkers.filter(
    ({ orderId, reservationId }) =>
      orderId !== undefined &&
      rowByOrderId.get(orderId)?.dotypos_reservation_id !== reservationId
  ).length;
  counts = {
    ...counts,
    exactOrderRowReadCount: orderRows.length,
    exactOrderRowQueryFailureCount: 0,
    exactOrderRowMissingCount,
    sourceMarkerRowReservationMismatchCount,
  };
  const sourceMarkerIds = new Set(
    sourceMarkers.map(({ reservationId }) => reservationId)
  );
  const candidateIds = [
    ...new Set([
      ...sourceMarkerIds,
      ...checkoutCleanup.checkoutRows.flatMap((row) =>
        row?.dotypos_reservation_id ? [row.dotypos_reservation_id] : []
      ),
      ...accountLane.dotyposReservationIds,
    ]),
  ].toSorted();
  const otherCandidateIds = new Set(
    candidateIds.filter((id) => !sourceMarkerIds.has(id))
  );
  const candidateIdSetSha256 = hashWorkspaceE2ECandidateIds(candidateIds);
  counts = {
    ...counts,
    candidateCount: candidateIds.length,
    candidateSetSha256: candidateIdSetSha256,
  };
  if (
    candidateIds.length !== singleMarkerRepairSourcePins.candidateCount ||
    sourceMarkerIds.size !==
      singleMarkerRepairSourcePins.completedMarkerCount ||
    otherCandidateIds.size !== 2
  ) {
    return { outcome: "failed", reason: "candidate_count_mismatch", counts };
  }
  if (
    candidateIdSetSha256 !==
    (input.expectedCandidateSetSha256 ??
      singleMarkerRepairSourcePins.candidateSetSha256)
  ) {
    return { outcome: "failed", reason: "candidate_set_mismatch", counts };
  }

  return {
    outcome: "ready",
    counts,
    accountLane,
    journalStates,
    sourceMarkers,
    orderRows,
    rowByOrderId,
    candidateIds,
    sourceMarkerIds,
    otherCandidateIds,
    candidateIdSetSha256,
    sourceMarkerIdSetSha256: hashWorkspaceE2ECandidateIds(sourceMarkerIds),
    otherCandidateIdSetSha256: hashWorkspaceE2ECandidateIds(otherCandidateIds),
  };
};
