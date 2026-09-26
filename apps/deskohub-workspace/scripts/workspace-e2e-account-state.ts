import "../shared/polyfills/temporal";

import { Effect, Exit, Layer, Logger, Schema } from "effect";
import { readSyntheticAccountState } from "../e2e/account/auth-rows";
import {
  makeWorkspaceE2EAccountRecipientForRunId,
  workspaceE2EAccountMainRecipientLabel,
} from "../e2e/account/config";
import { type DatasourceConfig, getDatasourceConfig } from "../e2e/config";
import { makeE2EEnvironment } from "../e2e/e2e-env";
import { E2EDatabase } from "../e2e/integrations/database.service";
import { readWorkspaceE2ERunContext } from "../e2e/playwright-checkout/run-context";
import { workspaceE2ERunIdSchema } from "../e2e/run-identifiers";
import { assertSafeDatabaseUrl } from "../e2e/runtime";
import { runStandaloneWorkspaceEffect } from "../shared/backend/standalone-workspace-effect";

/**
 * Bounded failure-only diagnostic for the Workspace E2E branch workflow. It
 * reconstructs the exact synthetic main account from the validated run
 * context of the failed run, classifies whether the account is missing,
 * exists without its customer-account link, or exists with that link, and
 * prints exactly one fixed low-cardinality token. It never prints the
 * recipient, run id, identifiers, URLs, or errors, never reads broader rows,
 * and always exits zero so it can never replace the original E2E conclusion.
 *
 * Output contract: `missing` | `unlinked` | `linked` on stdout; `unknown`
 * when the diagnostic itself could not classify.
 */
const unknownState = "unknown";

const classifyFromValidatedRunContext = async () => {
  const environment = makeE2EEnvironment();
  const datasourceConfig = getDatasourceConfig(environment);
  assertSafeDatabaseUrl(
    datasourceConfig.databaseUrl,
    "DATABASE_URL",
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
  );
  assertSafeDatabaseUrl(
    datasourceConfig.databaseUrlUnpooled,
    "WORKSPACE_E2E_DATABASE_URL_UNPOOLED",
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
  );
  const runContext = await readWorkspaceE2ERunContext();
  const runId = Schema.decodeSync(workspaceE2ERunIdSchema)(runContext.runId);
  const recipient = makeWorkspaceE2EAccountRecipientForRunId(
    runId,
    workspaceE2EAccountMainRecipientLabel
  );
  const stateExit = await readAccountState(datasourceConfig, recipient).pipe(
    runStandaloneWorkspaceEffect("workspace-e2e.account-state")
  );
  if (!Exit.isSuccess(stateExit)) {
    throw stateExit.cause;
  }
  return stateExit.value;
};

const readAccountState = (
  datasourceConfig: DatasourceConfig,
  recipient: string
) =>
  readSyntheticAccountState(recipient).pipe(
    Effect.provide(
      Layer.merge(E2EDatabase.layer(datasourceConfig), Logger.layer([]))
    ),
    Effect.exit
  );

let state: string = unknownState;
try {
  state = await classifyFromValidatedRunContext();
} catch {
  process.stderr.write(
    "Workspace E2E synthetic main account state could not be classified.\n"
  );
}
process.stdout.write(`${state}\n`);
