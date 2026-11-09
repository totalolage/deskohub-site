import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { isTestEmailAddress } from "@deskohub/test-email";
import { workspaceE2EAccountCaseIds } from "./account/catalog";
import { makeWorkspaceE2EAccountRecipientForRunId } from "./account/config";
import { workspaceE2EAccountLaneId } from "./account/journal";
import type { E2EEnvironment } from "./e2e-env";
import { nightlyCasesEnabled } from "./e2e-env";
import {
  isWorkspaceE2ENightlyCaseId,
  isWorkspaceE2EOfficeCaseId,
  workspaceE2ECaseIds,
} from "./playwright-checkout/case-catalog";
import { workspaceE2ECheckoutJournalOwners } from "./playwright-checkout/journal-owners";
import { readWorkspaceE2ERunPlan } from "./playwright-checkout/run-plan";
import {
  type ReservationIntent,
  readReservationJournal,
} from "./reservation-journal";
import { workspaceDir } from "./runtime";
import type { E2ERunContext } from "./services/telemetry";

export type RunOwnership = {
  readonly intents: readonly ReservationIntent[];
  readonly emails: readonly string[];
  readonly customerIds: readonly string[];
  readonly accountIds: readonly string[];
  readonly journalCount: number;
};

/** Uses the same case and identity owner registries as suite cleanup. */
export const readRunOwnership = async (
  environment: E2EEnvironment,
  artifactRoot = resolve(workspaceDir, "e2e-artifacts/checkout")
): Promise<RunOwnership> => {
  const plan = await readWorkspaceE2ERunPlan(
    resolve(artifactRoot, "run-plan.json")
  );
  const context = plan.runContext;
  const caseExpected = (caseId: string) =>
    (plan.preparation.office !== undefined ||
      !isWorkspaceE2EOfficeCaseId(caseId)) &&
    (nightlyCasesEnabled(environment) || !isWorkspaceE2ENightlyCaseId(caseId));
  if (
    context.runId !==
      `${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}` ||
    context.targetSha !== environment.TARGET_SHA ||
    context.githubRunId !== environment.GITHUB_RUN_ID ||
    context.githubRunAttempt !== environment.GITHUB_RUN_ATTEMPT
  )
    throw new Error("Unknown run ownership identity");
  const root = resolve(artifactRoot, "cleanup-journals");
  const accounts = resolve(artifactRoot, "account-journals");
  await assertKnownFiles(root, workspaceE2ECaseIds);
  await assertKnownFiles(
    accounts,
    workspaceE2ECheckoutJournalOwners.map(({ ownerId }) => ownerId)
  );
  const intents: ReservationIntent[] = [];
  const emails = new Set<string>();
  const customerIds = new Set<string>();
  const accountIds = new Set<string>();
  let journalCount = 0;
  for (const caseId of workspaceE2ECaseIds) {
    const journal = await readReservationJournal(
      resolve(root, `${caseId}.json`)
    );
    if (!journal) {
      if (caseExpected(caseId))
        throw new Error("Missing case ownership journal");
      continue;
    }
    if (journal.caseId !== caseId || !Array.isArray(journal.checkoutStates)) {
      throw new Error("Invalid case ownership journal");
    }
    for (const state of journal.checkoutStates) {
      if (
        !isRecord(state) ||
        !isRecord(state.data) ||
        typeof state.data.email !== "string"
      ) {
        throw new Error("Unknown checkout owner");
      }
      emails.add(state.data.email);
    }
    intents.push(
      ...parseReservationIntents(journal.reservationIntents, context, [caseId])
    );
    journalCount++;
  }
  for (const owner of workspaceE2ECheckoutJournalOwners) {
    const caseId = owner.caseId ?? owner.ownerId;
    for (const label of owner.recipientLabels) {
      emails.add(
        makeWorkspaceE2EAccountRecipientForRunId(context.runId, label)
      );
    }
    const journal = await readReservationJournal(
      resolve(accounts, `${owner.ownerId}.json`)
    );
    if (!journal) {
      if (caseId === workspaceE2EAccountLaneId || caseExpected(caseId))
        throw new Error("Missing account ownership journal");
      continue;
    }
    if (journal.laneId !== owner.ownerId)
      throw new Error("Unknown account owner");
    addIds(customerIds, journal.dotyposCustomerIds);
    addIds(accountIds, journal.authUserIds);
    // Account reservations are created by its catalog; referral fixtures use
    // their checkout case's journal, which is persisted before case admission.
    intents.push(
      ...parseReservationIntents(
        journal.reservationIntents,
        context,
        workspaceE2EAccountCaseIds
      )
    );
    journalCount++;
  }
  if (
    intents.length === 0 ||
    new Set(intents.map(({ id }) => id)).size !== intents.length
  )
    throw new Error("Missing or duplicate creation intent coverage");
  for (const intent of intents) {
    if ("email" in intent.owner) emails.add(intent.owner.email);
    else customerIds.add(intent.owner.customerId);
  }
  if ([...emails].some((email) => !isTestEmailAddress(email)))
    throw new Error("Unknown synthetic owner coverage");
  return {
    intents,
    emails: [...emails].toSorted(),
    customerIds: [...customerIds].toSorted(),
    accountIds: [...accountIds].toSorted(),
    journalCount,
  };
};

export const parseReservationIntents = (
  value: unknown,
  context: Pick<E2ERunContext, "runId">,
  cases: readonly string[]
): readonly ReservationIntent[] => {
  if (!Array.isArray(value))
    throw new Error("Missing reservation intent coverage");
  return value.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !entry.id ||
      typeof entry.caseId !== "string" ||
      !cases.includes(entry.caseId) ||
      entry.runId !== context.runId ||
      !isRecord(entry.owner) ||
      !(
        (typeof entry.owner.email === "string" &&
          entry.owner.email.length > 0) ||
        (typeof entry.owner.customerId === "string" &&
          entry.owner.customerId.length > 0)
      ) ||
      typeof entry.startDate !== "string" ||
      typeof entry.endDate !== "string" ||
      !Number.isFinite(Date.parse(entry.startDate)) ||
      !(Date.parse(entry.endDate) > Date.parse(entry.startDate)) ||
      !(entry.orderId === undefined || typeof entry.orderId === "string") ||
      !(
        entry.reservationId === undefined ||
        typeof entry.reservationId === "string"
      )
    )
      throw new Error("Unknown reservation intent coverage");
    return entry as ReservationIntent;
  });
};

const assertKnownFiles = async (path: string, owners: readonly string[]) => {
  const files = await readdir(path);
  const expected = new Set(owners.map((owner) => `${owner}.json`));
  if (files.some((file) => !expected.has(file)))
    throw new Error("Unenumerated reservation journal owner");
};

const addIds = (target: Set<string>, value: unknown) => {
  if (
    !Array.isArray(value) ||
    !value.every((id): id is string => typeof id === "string" && id.length > 0)
  ) {
    throw new Error("Unknown journal owner identity");
  }
  for (const id of value) target.add(id);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
