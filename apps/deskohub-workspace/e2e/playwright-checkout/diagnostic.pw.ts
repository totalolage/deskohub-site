import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DotyposReservationIdSchema, DotyposService } from "@deskohub/dotypos";
import { Effect, Logger, Option, Schema } from "effect";
import { prepareWorkspaceE2EAccountLaneReconciliation } from "../account/reconcile";
import { getWorkspaceE2EDateInterval } from "../capacity";
import { prepareCheckoutFlowCleanup } from "../cleanup";
import { getDatasourceConfig } from "../config";
import { workspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import {
  getDotyposLayer,
  readDotyposReservationStatus,
} from "../integrations/dotypos";
import { workspaceDir } from "../runtime";
import { workspaceE2ECaseIds } from "./case-catalog";
import {
  runWorkspaceE2ECleanupWithPreparedCandidates,
  type WorkspaceE2ECleanupCandidates,
} from "./cleanup-plan";
import { cleanupTest as test } from "./cleanup-runtime-fixtures";
import {
  countReservationStatusPartitions,
  type ReservationStatus,
  type ReservationStatusCounts,
  type ReservationStatusPartitions,
  reservationStatuses,
} from "./diagnostic-counts";
import { readWorkspaceE2ECaseJournals } from "./run-plan";

const expectedSourceRunId = "37580940745-1";
const expectedTargetSha = "d027de04a101a7f018960b81e164d53eb36d26cc";
const expectedTargetRef = "t3code/reorder-cowork-packages";
const expectedTargetUrl =
  "https://deskohub-workspace-site-a8nzc5sdh-filip-kalny-projects.vercel.app";
const expectedPrNumber = 464;
const expectedNeonBranchIdSha256 =
  "c4c75eb338e2522aa98c7312513391d5053c7246f1400ca45684374499a9a987";
const expectedDiagnosticCodeRef = "t3code/pr464-e2e-diagnostic-37580940745";
const expectedSourceArtifactManifestSha256 =
  "7736b918ac4c6a45675c997cbbf226e9dfd9e8047454bc9a492226f34b5e30e1";
const maximumConcurrentStatusReads = 4;
const expectedSourceArtifactFileCount = 36;
const expectedSourceStateCount = 36;
const expectedSourceCompletedMarkerCount = 36;
const allowedStatuses = reservationStatuses;

const decodeReservationId = Schema.decodeUnknownOption(
  DotyposReservationIdSchema
);

const isReservationStatus = (value: unknown): value is ReservationStatus =>
  allowedStatuses.some((status) => status === value);

const withoutEffectLogs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(Logger.layer([Logger.make(() => undefined)])));

const countStatuses = (statuses: readonly ReservationStatus[]) => {
  const counts: ReservationStatusCounts = {
    CANCELLED: 0,
    CONFIRMED: 0,
    NEW: 0,
  };
  for (const status of statuses) counts[status] += 1;
  return counts;
};

type ReadonlyDiagnosticReceipt = {
  readonly accountReservationCandidates: number;
  readonly activeInventoryIntersection: Record<ReservationStatus, number>;
  readonly activeInventoryIntersectionPartitions: ReservationStatusPartitions;
  readonly candidateStatuses: Record<ReservationStatus, number>;
  readonly candidateStatusPartitions: ReservationStatusPartitions;
  readonly checkoutRowCandidates: number;
  readonly completedAt: string;
  readonly completedSourceMarkers: number;
  readonly source: {
    readonly artifactFileCount: number;
    readonly artifactCleanupManifestSha256: string;
    readonly diagnosticCodeRef: string;
    readonly diagnosticCodeSha: string;
    readonly diagnosticRunAttempt: number;
    readonly diagnosticRunId: string;
    readonly githubRunAttempt: number;
    readonly githubRunId: string;
    readonly neonBranchIdSha256: string;
    readonly prNumber: number;
    readonly runId: string;
    readonly sourceCompletedMarkerCount: number;
    readonly sourceStateCount: number;
    readonly targetRef: string;
    readonly targetSha: string;
    readonly targetUrl: string;
  };
  readonly startedAt: string;
  readonly uniqueCandidateCount: number;
  readonly version: 1;
};

const makeDiagnostic = (
  candidates: WorkspaceE2ECleanupCandidates,
  datasourceConfig: ReturnType<typeof getDatasourceConfig>,
  readEffect: <A, E>(effect: Effect.Effect<A, E, E2EDatabase>) => Promise<A>,
  sourceArtifactManifestSha256: string
) => {
  const { accountLaneJournal, checkoutCleanup } = candidates;
  const sourceMarkerOccurrences = checkoutCleanup.flowStates.filter(
    (state) => state.completedDotyposReservationId !== undefined
  ).length;
  if (
    checkoutCleanup.flowStates.length !== expectedSourceStateCount ||
    sourceMarkerOccurrences !== expectedSourceCompletedMarkerCount
  ) {
    throw new Error("source_state_counts_mismatch");
  }
  const sourceMarkerIds = new Set(
    checkoutCleanup.flowStates.flatMap((state) => {
      if (!state.completedDotyposReservationId) return [];
      const id = Option.getOrUndefined(
        decodeReservationId(state.completedDotyposReservationId)
      );
      if (!id) throw new Error("source_marker_invalid");
      return [id];
    })
  );
  const checkoutRowIds = new Set(
    checkoutCleanup.checkoutRows.flatMap((row) =>
      row.dotypos_reservation_id ? [row.dotypos_reservation_id] : []
    )
  );
  const accountReservationIds = new Set(
    (accountLaneJournal?.dotyposReservationIds ?? []).map((value) => {
      const id = Option.getOrUndefined(decodeReservationId(value));
      if (!id) throw new Error("account_candidate_invalid");
      return id;
    })
  );
  const candidateIds = new Set([
    ...sourceMarkerIds,
    ...checkoutRowIds,
    ...accountReservationIds,
  ]);
  const flowDates = checkoutCleanup.flowStates
    .map(({ data }) => data.date)
    .sort();
  const fromDate = flowDates[0];
  const toDate = flowDates.at(-1);
  if (!fromDate || !toDate || candidateIds.size === 0) {
    throw new Error("source_candidates_missing");
  }

  const startedAt = new Date().toISOString();

  return readEffect(
    Effect.gen(function* () {
      const candidateStatusEntries = yield* Effect.forEach(
        [...candidateIds],
        (id) =>
          readDotyposReservationStatus(datasourceConfig, id).pipe(
            Effect.map((status) => {
              if (!isReservationStatus(status)) {
                throw new Error("reservation_status_unknown");
              }
              return [id, status] as const;
            })
          ),
        { concurrency: maximumConcurrentStatusReads }
      );
      const statusByCandidateId = new Map(candidateStatusEntries);
      const statusValues = candidateStatusEntries.map(([, status]) => status);

      const interval = getWorkspaceE2EDateInterval({ fromDate, toDate });
      const activeReservations = yield* Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listActiveReservationsOverlapping(interval);
      }).pipe(Effect.provide(getDotyposLayer(datasourceConfig)));

      const activeIdsByStatus: Record<ReservationStatus, Set<string>> = {
        CANCELLED: new Set(),
        CONFIRMED: new Set(),
        NEW: new Set(),
      };
      for (const reservation of activeReservations) {
        const id = Option.getOrUndefined(decodeReservationId(reservation.id));
        if (!id || !candidateIds.has(id)) continue;
        if (!isReservationStatus(reservation.status)) {
          throw new Error("inventory_status_unknown");
        }
        activeIdsByStatus[reservation.status].add(id);
      }

      const diagnosticCodeSha = process.env.GITHUB_SHA;
      const diagnosticRunId = process.env.GITHUB_RUN_ID;
      const diagnosticRunAttempt = process.env.GITHUB_RUN_ATTEMPT;
      if (
        !diagnosticCodeSha ||
        !/^[0-9a-f]{40}$/.test(diagnosticCodeSha) ||
        !diagnosticRunId ||
        !/^\d+$/.test(diagnosticRunId) ||
        !diagnosticRunAttempt ||
        !/^\d+$/.test(diagnosticRunAttempt)
      ) {
        throw new Error("diagnostic_workflow_identity_missing");
      }
      const intersectionCounts = Object.fromEntries(
        allowedStatuses.map((status) => [
          status,
          activeIdsByStatus[status].size,
        ])
      ) as Record<ReservationStatus, number>;
      const partitions = countReservationStatusPartitions(
        statusByCandidateId,
        sourceMarkerIds,
        activeIdsByStatus
      );
      return {
        accountReservationCandidates: accountReservationIds.size,
        activeInventoryIntersection: intersectionCounts,
        activeInventoryIntersectionPartitions:
          partitions.activeInventoryIntersectionPartitions,
        checkoutRowCandidates: checkoutRowIds.size,
        completedSourceMarkers: sourceMarkerIds.size,
        completedAt: new Date().toISOString(),
        candidateStatuses: countStatuses(statusValues),
        candidateStatusPartitions: partitions.candidateStatusPartitions,
        source: {
          artifactFileCount: expectedSourceStateCount,
          artifactCleanupManifestSha256: sourceArtifactManifestSha256,
          diagnosticCodeRef: expectedDiagnosticCodeRef,
          diagnosticCodeSha,
          diagnosticRunAttempt: Number(diagnosticRunAttempt),
          diagnosticRunId,
          githubRunAttempt: 1,
          githubRunId: "37580940745",
          neonBranchIdSha256: expectedNeonBranchIdSha256,
          prNumber: expectedPrNumber,
          runId: expectedSourceRunId,
          sourceCompletedMarkerCount: sourceMarkerOccurrences,
          sourceStateCount: checkoutCleanup.flowStates.length,
          targetRef: expectedTargetRef,
          targetSha: expectedTargetSha,
          targetUrl: expectedTargetUrl,
        },
        startedAt,
        uniqueCandidateCount: candidateIds.size,
        version: 1 as const,
      };
    }).pipe(
      Effect.mapError(() =>
        workspaceE2EError("Read-only reservation status diagnosis failed", {
          operation: "read source-owned reservation statuses",
        })
      )
    )
  );
};

test("diagnose pinned source reservation convergence without mutation", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const sourceArtifactManifestSha256 =
    process.env.WORKSPACE_E2E_SOURCE_CLEANUP_MANIFEST_SHA256;
  if (
    sourceArtifactManifestSha256 !== expectedSourceArtifactManifestSha256 ||
    process.env.WORKSPACE_E2E_SOURCE_ARTIFACT_FILE_COUNT !==
      String(expectedSourceArtifactFileCount) ||
    process.env.WORKSPACE_E2E_SOURCE_ARTIFACT_STATE_COUNT !==
      String(expectedSourceStateCount)
  ) {
    throw new Error("source_artifact_pin_mismatch");
  }
  if (
    process.env.WORKSPACE_E2E_EXPECTED_NEON_BRANCH_ID_SHA256 !==
    expectedNeonBranchIdSha256
  ) {
    throw new Error("source_database_pin_mismatch");
  }
  if (
    runContext.runId !== expectedSourceRunId ||
    runContext.targetSha !== expectedTargetSha ||
    runContext.prNumber !== expectedPrNumber ||
    runContext.executionContext !== "ci"
  ) {
    throw new Error("source_context_mismatch");
  }
  if (
    process.env.WORKSPACE_E2E_EXPECTED_TARGET_REF !== expectedTargetRef ||
    process.env.WORKSPACE_E2E_EXPECTED_TARGET_URL !== expectedTargetUrl ||
    process.env.WORKSPACE_E2E_DIAGNOSTIC_CODE_REF !== expectedDiagnosticCodeRef
  ) {
    throw new Error("workflow_source_pin_mismatch");
  }

  const datasourceConfig = getDatasourceConfig(environment);
  const runSafely = <A, E>(effect: Effect.Effect<A, E, E2EDatabase>) =>
    runEffect(withoutEffectLogs(effect));

  let receipt: ReadonlyDiagnosticReceipt;
  try {
    const result = await runWorkspaceE2ECleanupWithPreparedCandidates({
      readAccountLaneJournal: () =>
        runSafely(
          prepareWorkspaceE2EAccountLaneReconciliation(
            datasourceConfig,
            runContext.runId
          )
        ),
      readCheckoutCleanup: async () => {
        const flowStates =
          await readWorkspaceE2ECaseJournals(workspaceE2ECaseIds);
        return runSafely(
          prepareCheckoutFlowCleanup({ datasourceConfig, flowStates })
        );
      },
      reconcile: (candidates) =>
        makeDiagnostic(
          candidates,
          datasourceConfig,
          runSafely,
          sourceArtifactManifestSha256
        ),
    });
    receipt = result as ReadonlyDiagnosticReceipt;
  } catch {
    throw new Error("readonly_ownership_or_status_preflight_failed");
  }

  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "unknown";
  const runId = process.env.GITHUB_RUN_ID ?? "unknown";
  if (!/^\d+$/.test(attempt) || !/^\d+$/.test(runId)) {
    throw new Error("diagnostic_workflow_identity_missing");
  }
  const outputDirectory = resolve(
    workspaceDir,
    "e2e-artifacts",
    `checkout-readonly-diagnostic-${runId}-${attempt}`
  );
  await mkdir(outputDirectory, { recursive: false });
  await writeFile(
    resolve(outputDirectory, "reservation-convergence-counts.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
});
