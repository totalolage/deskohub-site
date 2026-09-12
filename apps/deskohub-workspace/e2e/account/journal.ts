import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { workspaceDir } from "../runtime";

const journalRoot = resolve(
  workspaceDir,
  "e2e-artifacts",
  "checkout",
  "cleanup-journals"
);
const laneJournalPath = resolve(journalRoot, "account-lane.json");
const formatVersion = 1;
export const workspaceE2EAccountLaneId = "account-lane";

/**
 * Ownership unit for the serial account lane: every synthetic provider and
 * identity row the lane created is journaled here by exact ID as soon as it
 * exists, so the suite cleanup reconciles the lane even after an interrupted
 * case. The journal never contains recipients, message bodies, URLs,
 * tokens, or cookies.
 */
export type WorkspaceE2EAccountJournal = {
  /** Exact Better Auth user rows; deletion cascades sessions, accounts, and links. */
  readonly authUserIds: readonly string[];
  readonly completed: boolean;
  /** Exact synthetic Dotypos profiles; finalizers expire, never delete. */
  readonly dotyposCustomerIds: readonly string[];
  /** Exact synthetic Dotypos reservations; finalizers cancel and converge. */
  readonly dotyposReservationIds: readonly string[];
  readonly laneId: typeof workspaceE2EAccountLaneId;
  readonly startedAt: string;
  readonly version: typeof formatVersion;
};

export const emptyWorkspaceE2EAccountJournal =
  (): WorkspaceE2EAccountJournal => ({
    authUserIds: [],
    completed: false,
    dotyposCustomerIds: [],
    dotyposReservationIds: [],
    laneId: workspaceE2EAccountLaneId,
    startedAt: new Date().toISOString(),
    version: formatVersion,
  });

export const writeWorkspaceE2EAccountJournal = async (
  journal: WorkspaceE2EAccountJournal
) => {
  await mkdir(journalRoot, { recursive: true });
  const temporaryPath = `${laneJournalPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, laneJournalPath);
};

export const readWorkspaceE2EAccountJournal = async (): Promise<
  WorkspaceE2EAccountJournal | undefined
> => {
  try {
    return parseJournal(await readFile(laneJournalPath, "utf8"));
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
};

const parseJournal = (serialized: string): WorkspaceE2EAccountJournal => {
  const value: unknown = JSON.parse(serialized);
  if (
    !isRecord(value) ||
    value.version !== formatVersion ||
    value.laneId !== workspaceE2EAccountLaneId ||
    typeof value.startedAt !== "string" ||
    typeof value.completed !== "boolean" ||
    !isStringArray(value.authUserIds) ||
    !isStringArray(value.dotyposCustomerIds) ||
    !isStringArray(value.dotyposReservationIds)
  ) {
    throw new Error("Invalid workspace E2E account lane journal");
  }
  return {
    authUserIds: value.authUserIds,
    completed: value.completed,
    dotyposCustomerIds: value.dotyposCustomerIds,
    dotyposReservationIds: value.dotyposReservationIds,
    laneId: value.laneId,
    startedAt: value.startedAt,
    version: value.version,
  } satisfies WorkspaceE2EAccountJournal;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
