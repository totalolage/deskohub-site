import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkspaceE2EPreparation } from "../cases";
import { writeReservationJournal } from "../reservation-journal";
import { workspaceDir, writeJsonAtomically } from "../runtime";
import type { E2ERunContext } from "../services/telemetry";
import type { CheckoutData, CheckoutFlowState } from "../types";
import { isWorkspaceE2ECaseId, type WorkspaceE2ECaseId } from "./case-catalog";

const checkoutArtifactRoot = resolve(workspaceDir, "e2e-artifacts", "checkout");
const runPlanPath = resolve(checkoutArtifactRoot, "run-plan.json");
const journalRoot = resolve(checkoutArtifactRoot, "cleanup-journals");
const formatVersion = 2;

export type WorkspaceE2ERunPlan = {
  readonly preparation: WorkspaceE2EPreparation;
  readonly runContext: E2ERunContext;
  readonly version: typeof formatVersion;
};

type WorkspaceE2ECleanupJournal = {
  readonly caseId: WorkspaceE2ECaseId;
  readonly checkoutStates: readonly SerializedCheckoutFlowState[];
  readonly startedAt: string;
  readonly version: typeof formatVersion;
};

type SerializedCheckoutFlowState = {
  readonly completedDotyposReservationId?: string;
  readonly data: CheckoutData;
  readonly orderId?: string;
  readonly startedAt?: string;
};

export const writeWorkspaceE2ERunPlan = async (plan: WorkspaceE2ERunPlan) =>
  writeJsonAtomically(runPlanPath, plan);

export const readWorkspaceE2ERunPlan = async (
  path = runPlanPath
): Promise<WorkspaceE2ERunPlan> => parseRunPlan(await readFile(path, "utf8"));

export const writeWorkspaceE2ECaseJournal = async (
  caseId: WorkspaceE2ECaseId,
  flowStates: readonly CheckoutFlowState[],
  journalStartedAt = new Date()
) =>
  writeReservationJournal(resolve(journalRoot, `${caseId}.json`), {
    caseId,
    checkoutStates: flowStates.map(
      ({ completedDotyposReservationId, data, orderId, startedAt }) => ({
        ...(completedDotyposReservationId
          ? { completedDotyposReservationId }
          : {}),
        data,
        ...(orderId ? { orderId } : {}),
        ...(startedAt ? { startedAt: startedAt.toISOString() } : {}),
      })
    ),
    startedAt: journalStartedAt.toISOString(),
    version: formatVersion,
  } satisfies WorkspaceE2ECleanupJournal);

export const readWorkspaceE2ECaseJournals = async (
  caseIds: readonly WorkspaceE2ECaseId[]
): Promise<readonly CheckoutFlowState[]> => {
  const journals = await Promise.all(
    caseIds.map(async (caseId) => {
      try {
        return parseCleanupJournal(
          await readFile(resolve(journalRoot, `${caseId}.json`), "utf8")
        );
      } catch (cause) {
        if (
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "ENOENT"
        ) {
          return undefined;
        }
        throw cause;
      }
    })
  );

  return journals.flatMap((journal) =>
    journal
      ? journal.checkoutStates.map(
          ({ completedDotyposReservationId, data, orderId, startedAt }) =>
            ({
              cleanupComplete: completedDotyposReservationId !== undefined,
              ...(completedDotyposReservationId
                ? { completedDotyposReservationId }
                : {}),
              data,
              ...(orderId ? { orderId } : {}),
              startedAt: new Date(startedAt ?? journal.startedAt),
            }) as CheckoutFlowState
        )
      : []
  );
};

const parseRunPlan = (serialized: string): WorkspaceE2ERunPlan => {
  const value: unknown = JSON.parse(serialized);
  if (
    !isRecord(value) ||
    value.version !== formatVersion ||
    !isRecord(value.preparation) ||
    !isRecord(value.runContext)
  ) {
    throw new Error("Invalid workspace E2E run plan");
  }
  return value as WorkspaceE2ERunPlan;
};

const parseCleanupJournal = (
  serialized: string
): WorkspaceE2ECleanupJournal => {
  const value: unknown = JSON.parse(serialized);
  if (
    !isRecord(value) ||
    value.version !== formatVersion ||
    typeof value.caseId !== "string" ||
    !isWorkspaceE2ECaseId(value.caseId) ||
    !Array.isArray(value.checkoutStates) ||
    !value.checkoutStates.every(
      (state) =>
        isRecord(state) &&
        isRecord(state.data) &&
        isOptionalString(state.completedDotyposReservationId) &&
        isOptionalString(state.orderId) &&
        isOptionalString(state.startedAt)
    ) ||
    typeof value.startedAt !== "string"
  ) {
    throw new Error("Invalid workspace E2E cleanup journal");
  }
  return value as WorkspaceE2ECleanupJournal;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isOptionalString = (value: unknown) =>
  value === undefined || typeof value === "string";
