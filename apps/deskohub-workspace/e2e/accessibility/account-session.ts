import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { Schema } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { signInWorkspaceE2ESyntheticBrowserContext } from "../account/seeded-session";
import { workspaceE2ERunIdSchema } from "../run-identifiers";
import { workspaceDir, writeJsonAtomically } from "../runtime";
import type { SeededAccountRuntime } from "./audit-target";
import {
  makeSeededAccountRunId,
  reconcileSeededAccount,
  seedLinkedAccount,
} from "./seeded-account";

const accountSessionLabel = "account";

/**
 * Lives in the config's output directory, which Playwright clears at start,
 * so only the current run's setup can have written it.
 */
const accountSessionPath = resolve(
  workspaceDir,
  "e2e-artifacts",
  "accessibility",
  "account-session.json"
);

const accountSessionSchema = Schema.Struct({
  accountId: Schema.optional(customerAccountIdSchema),
  runId: workspaceE2ERunIdSchema,
});

const readAccountSession = async () => {
  let serialized: string;
  try {
    serialized = await readFile(accountSessionPath, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
  return Schema.decodeUnknownSync(accountSessionSchema)(JSON.parse(serialized));
};

/**
 * Seeds the linked synthetic account the account audits sign in as. The run
 * id is recorded before the journal, so the teardown can always reconcile it.
 */
export const seedAccessibilityAccount = async (
  runtime: SeededAccountRuntime
) => {
  const runId = makeSeededAccountRunId();
  await writeJsonAtomically(accountSessionPath, { runId });
  const { accountId } = await seedLinkedAccount(
    runtime,
    runId,
    accountSessionLabel
  );
  await writeJsonAtomically(accountSessionPath, { accountId, runId });
};

/** Signs a browser context in as the seeded account with a fresh session. */
export const signInAccessibilityAccount = async (
  context: Pick<BrowserContext, "addCookies">,
  runtime: SeededAccountRuntime
) => {
  const accountId = (await readAccountSession())?.accountId;
  if (accountId === undefined) {
    throw new Error("The account session setup did not seed an account");
  }
  await runtime.runEffect(
    signInWorkspaceE2ESyntheticBrowserContext({
      accountId,
      context,
      origin: runtime.origin,
      secret: runtime.secret,
    })
  );
};

/** Expires the seeded profile and deletes the account by its journal. */
export const removeAccessibilityAccount = async (
  runtime: SeededAccountRuntime
) => {
  const session = await readAccountSession();
  if (session === undefined) return;
  await reconcileSeededAccount(runtime, session.runId, accountSessionLabel);
};
