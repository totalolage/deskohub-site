import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect, Logger } from "effect";
import { prepareWorkspaceE2EAccountLaneReconciliation } from "../account/reconcile";
import { getDatasourceConfig } from "../config";
import { readCheckoutRow } from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import { workspaceDir } from "../runtime";
import type { E2ERunContext } from "../services/telemetry";
import type { CheckoutRow } from "../types";
import { workspaceE2ECaseIds } from "./case-catalog";
import { cleanupTest as test } from "./cleanup-runtime-fixtures";
import { readWorkspaceE2ECaseJournalStates } from "./run-plan";
import {
  makeSingleMarkerRepairSourcePreflightReceipt,
  prepareSingleMarkerRepairSource,
  type SingleMarkerRepairPreflightFailureReason,
  type SingleMarkerRepairSourcePreflightReceipt,
  singleMarkerRepairSourcePins,
} from "./single-marker-repair-source";

const expectedTargetSha = "d027de04a101a7f018960b81e164d53eb36d26cc";
const expectedTargetRef = "t3code/reorder-cowork-packages";
const expectedTargetUrl =
  "https://deskohub-workspace-site-a8nzc5sdh-filip-kalny-projects.vercel.app";
const expectedNeonBranchIdSha256 =
  "c4c75eb338e2522aa98c7312513391d5053c7246f1400ca45684374499a9a987";
const expectedPreflightCodeRef =
  "t3code/pr464-e2e-single-marker-repair-37580940745";
const expectedPrNumber = 464;

const withoutEffectLogs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(Logger.layer([Logger.make(() => undefined)])));

const getPinFailureReason = (
  runContext: E2ERunContext
): SingleMarkerRepairPreflightFailureReason | undefined => {
  if (
    process.env.WORKSPACE_E2E_SINGLE_MARKER_PREFLIGHT_MODE !== "true" ||
    process.env.WORKSPACE_E2E_SOURCE_CLEANUP_MANIFEST_SHA256 !==
      singleMarkerRepairSourcePins.sourceArtifactManifestSha256 ||
    process.env.WORKSPACE_E2E_SOURCE_ARTIFACT_FILE_COUNT !==
      String(singleMarkerRepairSourcePins.sourceArtifactFileCount) ||
    process.env.WORKSPACE_E2E_SOURCE_ARTIFACT_STATE_COUNT !==
      String(singleMarkerRepairSourcePins.sourceStateCount) ||
    process.env.WORKSPACE_E2E_EXPECTED_NEON_BRANCH_ID_SHA256 !==
      expectedNeonBranchIdSha256 ||
    process.env.WORKSPACE_E2E_EXPECTED_CANDIDATE_SET_SHA256 !==
      singleMarkerRepairSourcePins.candidateSetSha256 ||
    process.env.WORKSPACE_E2E_EXPECTED_TARGET_REF !== expectedTargetRef ||
    process.env.WORKSPACE_E2E_EXPECTED_TARGET_URL !== expectedTargetUrl ||
    process.env.WORKSPACE_E2E_SINGLE_MARKER_PREFLIGHT_CODE_REF !==
      expectedPreflightCodeRef ||
    process.env.WORKSPACE_E2E_BASE_URL !== expectedTargetUrl ||
    process.env.TARGET_SHA !== expectedTargetSha
  ) {
    return "operation_pin_mismatch";
  }
  if (
    process.env.GITHUB_REF !== `refs/heads/${expectedPreflightCodeRef}` ||
    process.env.GITHUB_SHA === undefined ||
    !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA)
  ) {
    return "workflow_code_pin_mismatch";
  }
  if (
    runContext.runId !== singleMarkerRepairSourcePins.sourceRunId ||
    runContext.targetSha !== expectedTargetSha ||
    runContext.prNumber !== expectedPrNumber ||
    runContext.executionContext !== "ci"
  ) {
    return "source_context_mismatch";
  }
  return undefined;
};

const writePreflightReceipt = async (
  receipt: SingleMarkerRepairSourcePreflightReceipt
) => {
  const runId = process.env.GITHUB_RUN_ID;
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  if (!runId || !/^\d+$/.test(runId) || !attempt || !/^\d+$/.test(attempt)) {
    throw new Error("single_marker_repair_preflight_workflow_identity_missing");
  }
  const outputDirectory = resolve(
    workspaceDir,
    "e2e-artifacts",
    `checkout-single-marker-preflight-${runId}-${attempt}`
  );
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  await writeFile(
    resolve(outputDirectory, "preflight-counts.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
};

test("classify pinned source ownership preflight without fixture mutation", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const startedAt = new Date().toISOString();
  const codeSha = process.env.GITHUB_SHA;
  const executionRunId = process.env.GITHUB_RUN_ID;
  const executionRunAttempt = process.env.GITHUB_RUN_ATTEMPT;
  const source = {
    artifactCleanupManifestSha256:
      singleMarkerRepairSourcePins.sourceArtifactManifestSha256,
    artifactFileCount: singleMarkerRepairSourcePins.sourceArtifactFileCount,
    codeRef: expectedPreflightCodeRef,
    codeSha:
      codeSha && /^[0-9a-f]{40}$/.test(codeSha) ? codeSha : "unavailable",
    executionRunAttempt:
      executionRunAttempt && /^\d+$/.test(executionRunAttempt)
        ? Number(executionRunAttempt)
        : 0,
    executionRunId:
      executionRunId && /^\d+$/.test(executionRunId)
        ? executionRunId
        : "unavailable",
    neonBranchIdSha256: expectedNeonBranchIdSha256,
    prNumber: expectedPrNumber,
    runId: singleMarkerRepairSourcePins.sourceRunId,
    targetRef: expectedTargetRef,
    targetSha: expectedTargetSha,
    targetUrl: expectedTargetUrl,
  } as const;
  let preflight:
    | Awaited<ReturnType<typeof prepareSingleMarkerRepairSource>>
    | undefined;
  let failureReason: SingleMarkerRepairPreflightFailureReason | undefined =
    getPinFailureReason(runContext);

  if (failureReason === undefined) {
    try {
      const datasourceConfig = getDatasourceConfig(environment);
      const runSafely = <A, E>(effect: Effect.Effect<A, E, E2EDatabase>) =>
        runEffect(withoutEffectLogs(effect));
      preflight = await prepareSingleMarkerRepairSource({
        readAccountLane: () =>
          runSafely(
            prepareWorkspaceE2EAccountLaneReconciliation(
              datasourceConfig,
              runContext.runId
            )
          ),
        readJournalStates: () =>
          readWorkspaceE2ECaseJournalStates(workspaceE2ECaseIds),
        readCheckoutRow: (orderId) =>
          runSafely(readCheckoutRow(orderId as CheckoutRow["reservation_id"])),
      });
      if (preflight.outcome === "failed") {
        failureReason = preflight.reason;
      }
    } catch {
      failureReason = "source_preflight_failed";
    }
  }

  if (failureReason === undefined && preflight?.outcome !== "ready") {
    failureReason = "source_preflight_failed";
  }
  const receipt = makeSingleMarkerRepairSourcePreflightReceipt({
    preflight,
    ...(failureReason === undefined ? {} : { failureReason }),
    startedAt,
    completedAt: new Date().toISOString(),
    source,
  });
  await writePreflightReceipt(receipt);
  if (failureReason !== undefined) {
    throw new Error(`single_marker_repair_preflight_${failureReason}`);
  }
});
