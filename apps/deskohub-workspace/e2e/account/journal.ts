import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { workspaceDir } from "../runtime";

/**
 * The account identity journal directory of one Playwright suite's artifact
 * root. Referral-lane owners are checkout case IDs, so these journals keep
 * their own directory: sharing the checkout case journals' `<case id>.json`
 * names let each kind overwrite the other. Suites that run concurrently keep
 * separate roots, because Playwright clears each config's output directory.
 */
export const workspaceE2EAccountJournalDirectory = (
  suite: "checkout" | "instant-navigation"
) => resolve(workspaceDir, "e2e-artifacts", suite, "account-journals");

const checkoutJournalDirectory = workspaceE2EAccountJournalDirectory("checkout");
const formatVersion = 1;
export const workspaceE2EAccountLaneId = "account-lane";

/**
 * The owner of one account identity journal: the serial account lane, or one
 * referral-lane case whose synthetic identities never cross into another case.
 */
export type WorkspaceE2EAccountJournalOwnerId = string;

const ownerIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const journalPath = (
  ownerId: WorkspaceE2EAccountJournalOwnerId,
  directory: string
) => {
  if (!ownerIdPattern.test(ownerId)) {
    throw new Error("Invalid workspace E2E account journal owner");
  }
  return resolve(directory, `${ownerId}.json`);
};

/**
 * Ownership unit for synthetic account identities: every synthetic provider
 * and identity row the owner created is journaled here by exact ID as soon as
 * it exists, so the suite cleanup reconciles it even after an interrupted
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
  readonly laneId: WorkspaceE2EAccountJournalOwnerId;
  readonly startedAt: string;
  readonly version: typeof formatVersion;
};

export const emptyWorkspaceE2EAccountJournal = (
  ownerId: WorkspaceE2EAccountJournalOwnerId = workspaceE2EAccountLaneId
): WorkspaceE2EAccountJournal => ({
  authUserIds: [],
  completed: false,
  dotyposCustomerIds: [],
  dotyposReservationIds: [],
  laneId: ownerId,
  startedAt: new Date().toISOString(),
  version: formatVersion,
});

export const writeWorkspaceE2EAccountJournal = async (
  journal: WorkspaceE2EAccountJournal,
  directory: string = checkoutJournalDirectory
) => {
  await mkdir(directory, { recursive: true });
  const path = journalPath(journal.laneId, directory);
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
};

type WorkspaceE2EAccountJournalIds = Pick<
  WorkspaceE2EAccountJournal,
  "authUserIds" | "dotyposCustomerIds" | "dotyposReservationIds"
>;

/**
 * Accumulates one owner's exact IDs and persists the whole journal after every
 * addition, so an interrupted case still leaves every row it created behind
 * for suite cleanup.
 */
export const makeWorkspaceE2EAccountJournalRecorder = (
  ownerId: WorkspaceE2EAccountJournalOwnerId,
  directory: string = checkoutJournalDirectory
) => {
  let journal = emptyWorkspaceE2EAccountJournal(ownerId);
  const merge = (
    existing: readonly string[],
    added: readonly string[] = []
  ) => [...new Set([...existing, ...added])];
  return {
    get journal(): WorkspaceE2EAccountJournal {
      return journal;
    },
    record: async (update: Partial<WorkspaceE2EAccountJournalIds>) => {
      journal = {
        ...journal,
        authUserIds: merge(journal.authUserIds, update.authUserIds),
        dotyposCustomerIds: merge(
          journal.dotyposCustomerIds,
          update.dotyposCustomerIds
        ),
        dotyposReservationIds: merge(
          journal.dotyposReservationIds,
          update.dotyposReservationIds
        ),
      };
      await writeWorkspaceE2EAccountJournal(journal, directory);
    },
  };
};

export const readWorkspaceE2EAccountJournal = async (
  ownerId: WorkspaceE2EAccountJournalOwnerId = workspaceE2EAccountLaneId,
  directory: string = checkoutJournalDirectory
): Promise<WorkspaceE2EAccountJournal | undefined> => {
  try {
    return parseWorkspaceE2EAccountJournal(
      await readFile(journalPath(ownerId, directory), "utf8"),
      ownerId
    );
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
};

export const parseWorkspaceE2EAccountJournal = (
  serialized: string,
  ownerId: WorkspaceE2EAccountJournalOwnerId = workspaceE2EAccountLaneId
): WorkspaceE2EAccountJournal => {
  const value: unknown = JSON.parse(serialized);
  if (
    !isRecord(value) ||
    value.version !== formatVersion ||
    value.laneId !== ownerId ||
    typeof value.startedAt !== "string" ||
    typeof value.completed !== "boolean" ||
    !isStringArray(value.authUserIds) ||
    !isStringArray(value.dotyposCustomerIds) ||
    !isStringArray(value.dotyposReservationIds)
  ) {
    throw new Error("Invalid workspace E2E account journal");
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
