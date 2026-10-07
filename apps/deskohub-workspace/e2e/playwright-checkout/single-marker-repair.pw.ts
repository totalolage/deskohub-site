import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposReservationIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Logger, Option, Schema } from "effect";
import {
  assertNoAuthRows,
  findLinkedDotyposCustomerId,
} from "../account/auth-rows";
import {
  cancelSyntheticReservation,
  readSyntheticCustomerProfile,
} from "../account/fixtures";
import { readWorkspaceE2EAccountJournal } from "../account/journal";
import {
  prepareWorkspaceE2EAccountLaneReconciliation,
  reconcileWorkspaceE2EAccountLane,
} from "../account/reconcile";
import { getWorkspaceE2EDateInterval } from "../capacity";
import { getDatasourceConfig } from "../config";
import { readCheckoutRow } from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import {
  getDotyposLayer,
  readDotyposReservationStatus,
  waitForCancelledDotyposReservations,
} from "../integrations/dotypos";
import { pollUntil } from "../polling";
import { workspaceDir } from "../runtime";
import type { E2ERunContext } from "../services/telemetry";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type { CheckoutRow } from "../types";
import { workspaceE2ECaseIds } from "./case-catalog";
import { cleanupTest as test } from "./cleanup-runtime-fixtures";
import { readWorkspaceE2ECaseJournalStates } from "./run-plan";
import {
  assertSingleMarkerRepairAccountPostconditions,
  assertSingleMarkerRepairSourceOwnership,
  prepareSingleMarkerRepairPlan,
  runSingleMarkerRepair,
  type SingleMarkerRepairReservationStatus,
  type SingleMarkerRepairSourceMarker,
  singleMarkerRepairReservationStatuses,
} from "./single-marker-repair";
import { hashWorkspaceE2ECandidateIds } from "./source-candidate-set";

const expectedSourceRunId = "37580940745-1";
const expectedTargetSha = "d027de04a101a7f018960b81e164d53eb36d26cc";
const expectedTargetRef = "t3code/reorder-cowork-packages";
const expectedTargetUrl =
  "https://deskohub-workspace-site-a8nzc5sdh-filip-kalny-projects.vercel.app";
const expectedPrNumber = 464;
const expectedNeonBranchIdSha256 =
  "c4c75eb338e2522aa98c7312513391d5053c7246f1400ca45684374499a9a987";
// Replaced only after a reviewed fresh read-only candidate-set anchor.
const expectedCandidateSetSha256 =
  "70628d48020610f47c9292bb5cbb6fd7eaac92ac5d77cdd1eec0eeafb5a7d55a";
const expectedRepairCodeRef =
  "t3code/pr464-e2e-single-marker-repair-37580940745";
const expectedSourceArtifactManifestSha256 =
  "7736b918ac4c6a45675c997cbbf226e9dfd9e8047454bc9a492226f34b5e30e1";
const expectedSourceArtifactFileCount = 36;
const expectedSourceStateCount = 36;
const expectedSourceCompletedMarkerCount = 36;
const expectedCandidateCount = 38;
const maximumConcurrentReads = 4;

type RepairReceipt = {
  readonly accountPostconditions: {
    readonly authCandidates: number;
    readonly customerCandidates: number;
    readonly expiredRetainedCustomers: number;
    readonly remainingAuthAccounts: 0;
    readonly remainingAuthSessions: 0;
    readonly remainingAuthUsers: 0;
    readonly remainingCustomerLinks: 0;
  };
  readonly cancelledReservationCount: 1;
  readonly candidateCount: number;
  readonly candidateIdSetSha256: string;
  readonly candidateStatusPartitions: {
    readonly otherCandidates: Record<
      SingleMarkerRepairReservationStatus,
      number
    >;
    readonly sourceMarkers: Record<SingleMarkerRepairReservationStatus, number>;
  };
  readonly completedAt: string;
  readonly otherCandidateIdSetSha256: string;
  readonly sourceMarkerIdSetSha256: string;
  readonly skippedCancelledCandidateCount: 37;
  readonly source: {
    readonly artifactCleanupManifestSha256: string;
    readonly artifactFileCount: number;
    readonly candidateSetAnchorSha256: string;
    readonly codeRef: string;
    readonly codeSha: string;
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
  readonly targetSourceCaseId: string;
  readonly version: 1;
};

const decodeReservationId = Schema.decodeUnknownOption(
  DotyposReservationIdSchema
);

const withoutEffectLogs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(Logger.layer([Logger.make(() => undefined)])));

const countStatusPartitions = (
  statusByCandidateId: ReadonlyMap<string, string>,
  sourceMarkerIds: ReadonlySet<string>
) => {
  const sourceMarkers: Record<SingleMarkerRepairReservationStatus, number> = {
    CANCELLED: 0,
    CONFIRMED: 0,
    NEW: 0,
  };
  const otherCandidates: Record<SingleMarkerRepairReservationStatus, number> = {
    CANCELLED: 0,
    CONFIRMED: 0,
    NEW: 0,
  };
  for (const [id, status] of statusByCandidateId) {
    if (
      !singleMarkerRepairReservationStatuses.some(
        (allowedStatus) => allowedStatus === status
      )
    ) {
      throw new Error("single_marker_repair_status_unknown");
    }
    const partition = sourceMarkerIds.has(id) ? sourceMarkers : otherCandidates;
    partition[status as SingleMarkerRepairReservationStatus] += 1;
  }
  return { otherCandidates, sourceMarkers };
};

const validateOperationPins = (runContext: E2ERunContext) => {
  if (
    process.env.WORKSPACE_E2E_SINGLE_MARKER_REPAIR_MODE !== "true" ||
    process.env.WORKSPACE_E2E_SOURCE_CLEANUP_MANIFEST_SHA256 !==
      expectedSourceArtifactManifestSha256 ||
    process.env.WORKSPACE_E2E_SOURCE_ARTIFACT_FILE_COUNT !==
      String(expectedSourceArtifactFileCount) ||
    process.env.WORKSPACE_E2E_SOURCE_ARTIFACT_STATE_COUNT !==
      String(expectedSourceStateCount) ||
    process.env.WORKSPACE_E2E_EXPECTED_NEON_BRANCH_ID_SHA256 !==
      expectedNeonBranchIdSha256 ||
    process.env.WORKSPACE_E2E_EXPECTED_CANDIDATE_SET_SHA256 !==
      expectedCandidateSetSha256 ||
    process.env.WORKSPACE_E2E_EXPECTED_TARGET_REF !== expectedTargetRef ||
    process.env.WORKSPACE_E2E_EXPECTED_TARGET_URL !== expectedTargetUrl ||
    process.env.WORKSPACE_E2E_SINGLE_MARKER_REPAIR_CODE_REF !==
      expectedRepairCodeRef ||
    process.env.WORKSPACE_E2E_BASE_URL !== expectedTargetUrl ||
    process.env.TARGET_SHA !== expectedTargetSha ||
    process.env.GITHUB_REF !== `refs/heads/${expectedRepairCodeRef}` ||
    process.env.GITHUB_SHA === undefined ||
    !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA) ||
    runContext.runId !== expectedSourceRunId ||
    runContext.targetSha !== expectedTargetSha ||
    runContext.prNumber !== expectedPrNumber ||
    runContext.executionContext !== "ci"
  ) {
    throw new Error("single_marker_repair_source_pin_mismatch");
  }
};

const toSafeReservationId = (value: string): DotyposReservationId => {
  const id = Option.getOrUndefined(decodeReservationId(value));
  if (!id) throw new Error("single_marker_repair_source_marker_invalid");
  return id;
};

const writeRepairReceipt = async (receipt: RepairReceipt) => {
  const runId = process.env.GITHUB_RUN_ID;
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  if (!runId || !/^\d+$/.test(runId) || !attempt || !/^\d+$/.test(attempt)) {
    throw new Error("single_marker_repair_workflow_identity_missing");
  }
  const outputDirectory = resolve(
    workspaceDir,
    "e2e-artifacts",
    `checkout-single-marker-repair-${runId}-${attempt}`
  );
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  await writeFile(
    resolve(outputDirectory, "repair-counts.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
};

test("repair one pinned confirmed marker after source ownership and convergence", async ({
  environment,
  runContext,
  runEffect,
}) => {
  validateOperationPins(runContext);
  const datasourceConfig = getDatasourceConfig(environment);
  const runSafely = <A, E>(effect: Effect.Effect<A, E, E2EDatabase>) =>
    runEffect(withoutEffectLogs(effect));
  const startedAt = new Date().toISOString();
  let phase = "source_ownership_preflight";

  try {
    const [accountLane, journalStates] = await Promise.all([
      runSafely(
        prepareWorkspaceE2EAccountLaneReconciliation(
          datasourceConfig,
          runContext.runId
        )
      ),
      readWorkspaceE2ECaseJournalStates(workspaceE2ECaseIds),
    ]);
    if (accountLane?.journal.dotyposReservationIds.length !== 0) {
      throw new Error("single_marker_repair_account_scope_invalid");
    }

    const sourceMarkers: SingleMarkerRepairSourceMarker[] =
      journalStates.flatMap(({ caseId, state }) =>
        state.completedDotyposReservationId
          ? [
              {
                caseId,
                expectedEmail: state.data.email,
                orderId: state.orderId,
                reservationId: toSafeReservationId(
                  state.completedDotyposReservationId
                ),
              },
            ]
          : []
      );
    if (
      journalStates.length !== expectedSourceStateCount ||
      sourceMarkers.length !== expectedSourceCompletedMarkerCount
    ) {
      throw new Error("single_marker_repair_source_state_count_mismatch");
    }

    const orderIds = [
      ...new Set(
        journalStates.flatMap(({ state }) =>
          state.orderId ? [state.orderId] : []
        )
      ),
    ];
    const orderRows = await runSafely(
      Effect.forEach(
        orderIds,
        (orderId) =>
          readCheckoutRow(orderId).pipe(
            Effect.map((row) => [orderId, row] as const)
          ),
        { concurrency: maximumConcurrentReads }
      )
    );
    const rowByOrderId = new Map<string, CheckoutRow | undefined>(orderRows);
    const candidateIds = [
      ...new Set([
        ...sourceMarkers.map(({ reservationId }) => reservationId),
        ...orderRows.flatMap(([, row]) =>
          row?.dotypos_reservation_id ? [row.dotypos_reservation_id] : []
        ),
      ]),
    ].toSorted();
    const sourceMarkerIds = new Set(
      sourceMarkers.map(({ reservationId }) => reservationId)
    );
    const otherCandidateIds = new Set(
      candidateIds.filter((id) => !sourceMarkerIds.has(id))
    );
    const candidateIdSetSha256 = hashWorkspaceE2ECandidateIds(candidateIds);
    const sourceMarkerIdSetSha256 =
      hashWorkspaceE2ECandidateIds(sourceMarkerIds);
    const otherCandidateIdSetSha256 =
      hashWorkspaceE2ECandidateIds(otherCandidateIds);
    if (
      candidateIds.length !== expectedCandidateCount ||
      sourceMarkerIds.size !== expectedSourceCompletedMarkerCount ||
      otherCandidateIds.size !== 2
    ) {
      throw new Error("single_marker_repair_candidate_count_mismatch");
    }
    if (candidateIdSetSha256 !== expectedCandidateSetSha256) {
      throw new Error("single_marker_repair_candidate_set_mismatch");
    }

    phase = "reservation_status_preflight";
    const statusEntries = await runSafely(
      Effect.forEach(
        candidateIds,
        (candidateId) =>
          readDotyposReservationStatus(
            datasourceConfig,
            candidateId as DotyposReservationId
          ).pipe(Effect.map((status) => [candidateId, status] as const)),
        { concurrency: maximumConcurrentReads }
      )
    );
    const statusByCandidateId = new Map(statusEntries);
    const sourceDates = journalStates
      .map(({ state }) => state.data.date)
      .toSorted();
    const fromDate = sourceDates[0];
    const toDate = sourceDates.at(-1);
    if (!fromDate || !toDate) {
      throw new Error("single_marker_repair_source_dates_missing");
    }
    const interval = getWorkspaceE2EDateInterval({ fromDate, toDate });
    const activeInventory = await runSafely(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        const activeReservations =
          yield* dotypos.listActiveReservationsOverlapping(interval);
        return activeReservations.flatMap((reservation) => {
          const id = Option.getOrUndefined(decodeReservationId(reservation.id));
          if (!id || !candidateIds.includes(id)) return [];
          if (
            !singleMarkerRepairReservationStatuses.some(
              (allowedStatus) => allowedStatus === reservation.status
            )
          ) {
            throw new Error("single_marker_repair_inventory_status_unknown");
          }
          return [{ reservationId: id, status: reservation.status }];
        });
      }).pipe(Effect.provide(getDotyposLayer(datasourceConfig)))
    );
    const plan = prepareSingleMarkerRepairPlan({
      sourceMarkers,
      candidateIds,
      expectedCandidateSetSha256,
      statusByCandidateId,
      activeInventory,
    });
    const statusPartitions = countStatusPartitions(
      statusByCandidateId,
      sourceMarkerIds
    );

    phase = "target_ownership_preflight";
    const ownerDetails = async (marker: SingleMarkerRepairSourceMarker) => {
      const row = marker.orderId ? rowByOrderId.get(marker.orderId) : undefined;
      const provider = await runSafely(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos.getReservation(
            toSafeReservationId(marker.reservationId)
          );
        }).pipe(Effect.provide(getDotyposLayer(datasourceConfig)))
      );
      return { marker, row, provider };
    };

    const receiptMetadata = {
      artifactCleanupManifestSha256: expectedSourceArtifactManifestSha256,
      artifactFileCount: expectedSourceArtifactFileCount,
      codeRef: expectedRepairCodeRef,
      codeSha: process.env.GITHUB_SHA as string,
      githubRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      githubRunId: process.env.GITHUB_RUN_ID as string,
      neonBranchIdSha256: expectedNeonBranchIdSha256,
      prNumber: expectedPrNumber,
      runId: expectedSourceRunId,
      sourceCompletedMarkerCount: expectedSourceCompletedMarkerCount,
      sourceStateCount: expectedSourceStateCount,
      targetRef: expectedTargetRef,
      targetSha: expectedTargetSha,
      targetUrl: expectedTargetUrl,
    };

    const repairResult = await runSingleMarkerRepair({
      plan,
      candidateIds,
      assertTargetOwnership: async (marker) => {
        const { provider, row } = await ownerDetails(marker);
        const profile = row?.dotypos_customer_id
          ? await runSafely(
              readSyntheticCustomerProfile(
                datasourceConfig,
                row.dotypos_customer_id
              )
            )
          : undefined;
        assertSingleMarkerRepairSourceOwnership({
          marker,
          checkoutRow: row
            ? {
                customerId: row.dotypos_customer_id,
                orderId: row.reservation_id,
                reservationId: row.dotypos_reservation_id,
              }
            : undefined,
          reservation: provider
            ? {
                customerEmail: provider.customer.email ?? null,
                customerId: provider.customer.id ?? null,
                reservationId: provider.reservation.id ?? "",
              }
            : undefined,
          customer: profile
            ? {
                customerId: profile.id ?? "",
                email: profile.email ?? null,
              }
            : undefined,
        });
      },
      cancelTarget: (marker) => {
        phase = "single_reservation_cancel";
        return runSafely(
          cancelSyntheticReservation(
            datasourceConfig,
            toSafeReservationId(marker.reservationId)
          )
        );
      },
      convergeAllCandidates: async (ids) => {
        phase = "checkout_convergence";
        await runSafely(
          waitForCancelledDotyposReservations(
            datasourceConfig,
            ids.map((id) => id as DotyposReservationId),
            interval
          )
        );
        await runSafely(
          pollUntil(
            Effect.forEach(
              ids,
              (id) =>
                readDotyposReservationStatus(
                  datasourceConfig,
                  id as DotyposReservationId
                ),
              { concurrency: maximumConcurrentReads }
            ).pipe(
              Effect.map((statuses) => {
                if (
                  statuses.some(
                    (status) =>
                      !singleMarkerRepairReservationStatuses.some(
                        (allowedStatus) => allowedStatus === status
                      ) || status === "NEW"
                  )
                ) {
                  throw new Error("single_marker_repair_detail_status_invalid");
                }
                return statuses.every((status) => status === "CANCELLED")
                  ? true
                  : undefined;
              })
            ),
            {
              intervalMs: workspaceE2EPollIntervalMs.datasource,
              label: "source reservation detail cancellation convergence",
              timeoutMs: datasourceConfig.timeouts.datasource,
            }
          )
        );
      },
      reconcileAccountLane: async () => {
        phase = "account_reconciliation";
        await runSafely(
          reconcileWorkspaceE2EAccountLane(datasourceConfig, accountLane)
        );
      },
      assertAccountPostconditions: async () => {
        phase = "account_postconditions";
        const originalJournal = accountLane.journal;
        const currentJournal = await readWorkspaceE2EAccountJournal();
        if (!currentJournal) {
          throw new Error("single_marker_repair_account_journal_missing");
        }

        await Promise.all(
          originalJournal.authUserIds.map(async (accountId) => {
            await runSafely(assertNoAuthRows(accountId));
            const linkedCustomerId = await runSafely(
              findLinkedDotyposCustomerId(accountId)
            );
            if (linkedCustomerId !== undefined) {
              throw new Error("single_marker_repair_account_link_remaining");
            }
          })
        );

        const expiredRetainedCustomers = await runSafely(
          Effect.forEach(
            originalJournal.dotyposCustomerIds,
            (customerId) =>
              readSyntheticCustomerProfile(
                datasourceConfig,
                customerId as DotyposCustomerId
              ).pipe(
                Effect.map((customer) =>
                  customer.id === customerId &&
                  customer.expireDate != null &&
                  new Date(customer.expireDate).getTime() <= Date.now()
                    ? 1
                    : 0
                )
              ),
            { concurrency: maximumConcurrentReads }
          )
        ).then((counts) =>
          counts.reduce<number>((total, count) => total + count, 0)
        );

        assertSingleMarkerRepairAccountPostconditions({
          originalJournal,
          completedJournal: currentJournal,
          remainingAuthUsers: 0,
          remainingAuthSessions: 0,
          remainingAuthAccounts: 0,
          remainingCustomerLinks: 0,
          expiredRetainedCustomers,
        });
        return {
          authCandidates: originalJournal.authUserIds.length,
          customerCandidates: originalJournal.dotyposCustomerIds.length,
          expiredRetainedCustomers,
          remainingAuthAccounts: 0 as const,
          remainingAuthSessions: 0 as const,
          remainingAuthUsers: 0 as const,
          remainingCustomerLinks: 0 as const,
        };
      },
    });

    const receipt: RepairReceipt = {
      accountPostconditions: repairResult.accountPostconditions,
      cancelledReservationCount: repairResult.cancelledReservationCount,
      candidateCount: plan.candidateCount,
      candidateIdSetSha256,
      candidateStatusPartitions: statusPartitions,
      completedAt: new Date().toISOString(),
      skippedCancelledCandidateCount:
        repairResult.skippedCancelledCandidateCount,
      otherCandidateIdSetSha256,
      sourceMarkerIdSetSha256,
      source: {
        ...receiptMetadata,
        candidateSetAnchorSha256: expectedCandidateSetSha256,
        sourceStateCount: journalStates.length,
        sourceCompletedMarkerCount: sourceMarkers.length,
      },
      startedAt,
      targetSourceCaseId: plan.target.caseId,
      version: 1,
    };
    await writeRepairReceipt(receipt);
  } catch {
    throw new Error(`single_marker_repair_${phase}_failed`);
  }
});
