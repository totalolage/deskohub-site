import { Effect, Schema } from "effect";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import { createSyntheticCustomerProfile } from "../account/fixtures";
import {
  makeWorkspaceE2EAccountJournalRecorder,
  workspaceE2EAccountJournalDirectory,
} from "../account/journal";
import { workspaceE2EAccountProfileFixture } from "../account/profile-fixture";
import {
  prepareWorkspaceE2EAccountJournalReconciliations,
  reconcileWorkspaceE2EAccountJournals,
  type WorkspaceE2EAccountJournalOwner,
} from "../account/reconcile";
import { seedWorkspaceE2ESyntheticAccount } from "../account/seeded-session";
import {
  type WorkspaceE2ERunId,
  workspaceE2ERunIdSchema,
} from "../run-identifiers";
import type { makeSeededAccountRuntime } from "./audit-target";

type SeededAccountRuntime = ReturnType<typeof makeSeededAccountRuntime>;

/**
 * Journaled in this config's output directory. Each audit reconciles its own
 * journal when it finishes, so nothing else reads it.
 */
const accessibilityJournalDirectory =
  workspaceE2EAccountJournalDirectory("accessibility");

/** The one account an audit run owns, under its run-scoped journal. */
const seededAccountJournalOwner = (runId: WorkspaceE2ERunId, label: string) =>
  ({
    journalDirectory: accessibilityJournalDirectory,
    ownerId: runId,
    recipientLabels: [label],
  }) satisfies WorkspaceE2EAccountJournalOwner;

export const makeSeededAccountRunId = () =>
  Schema.decodeSync(workspaceE2ERunIdSchema)(
    `a11y-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  );

/**
 * Seeds a verified synthetic account linked to a new synthetic Dotypos
 * profile, a returning customer whose account sections and checkout ask for
 * nothing more. Every identity is journaled before it exists, so
 * `reconcileSeededAccount` can always remove it.
 */
export const seedLinkedAccount = async (
  runtime: SeededAccountRuntime,
  runId: WorkspaceE2ERunId,
  label: string
) => {
  const owner = seededAccountJournalOwner(runId, label);
  const recorder = makeWorkspaceE2EAccountJournalRecorder(
    owner.ownerId,
    owner.journalDirectory
  );
  const accountId: CustomerAccountId = customerAccountIdSchema.make(
    `accessibility-${label}-${crypto.randomUUID()}`
  );
  const email = makeWorkspaceE2EAccountRecipientForRunId(runId, label);
  await recorder.record({ authUserIds: [accountId] });
  const customerId = await runtime.runPromise(
    createSyntheticCustomerProfile(runtime.datasourceConfig, {
      email,
      firstName: workspaceE2EAccountProfileFixture.firstName,
      phone: workspaceE2EAccountProfileFixture.phone,
    })
  );
  await recorder.record({ dotyposCustomerIds: [customerId] });
  await runtime.runPromise(
    seedWorkspaceE2ESyntheticAccount({
      accountId,
      email,
      linkedCustomerId: customerId,
      name: "Accessibility Audit",
    })
  );
  return { accountId, recorder };
};

/**
 * Cancels the journaled reservations, expires the journaled profiles, and
 * deletes the journaled account, as the account lane's cleanup does.
 */
export const reconcileSeededAccount = (
  runtime: SeededAccountRuntime,
  runId: WorkspaceE2ERunId,
  label: string
) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const prepared = yield* prepareWorkspaceE2EAccountJournalReconciliations(
        runtime.datasourceConfig,
        runId,
        [seededAccountJournalOwner(runId, label)]
      );
      yield* reconcileWorkspaceE2EAccountJournals(prepared);
    })
  );
