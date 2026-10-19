import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { WorkspaceE2EAccountResourceService } from "../account/resources.service";
import {
  assertNexiSandbox,
  type DatasourceConfig,
  getConfig,
  getDatasourceConfig,
} from "../config";
import { makeAgentEvalEnvironment, makeE2EEnvironment } from "../e2e-env";
import { E2EDatabase } from "../integrations/database.service";
import { assertSafeDatabaseUrl } from "../runtime";
import { parseAgentEvalHarnesses } from "./harness-contract";

/**
 * Everything an agent eval process needs from its environment: the preview
 * target and bypass, its database and Dotypos sandbox, and the devbox's
 * harness list. Fails closed on a database the operator didn't allowlist or
 * a Nexi origin other than the sandbox.
 */
export const makeAgentEvalSettings = () => {
  const environment = makeE2EEnvironment();
  const agentEnvironment = makeAgentEvalEnvironment();
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  assertSafeDatabaseUrl(
    datasourceConfig.databaseUrlUnpooled,
    "WORKSPACE_E2E_DATABASE_URL_UNPOOLED",
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
  );
  assertNexiSandbox(datasourceConfig.nexiApiOrigin);
  const harnessListPath = resolve(
    agentEnvironment.WORKSPACE_AGENT_EVAL_HARNESSES
  );
  return {
    config,
    datasourceConfig,
    environment,
    harnessDirectory: dirname(harnessListPath),
    harnesses: parseAgentEvalHarnesses(readFileSync(harnessListPath, "utf8")),
    /** The commit the preview must be built from. */
    targetSha: agentEnvironment.TARGET_SHA,
    vercelProjectId: agentEnvironment.WORKSPACE_E2E_VERCEL_PROJECT,
    vercelToken: agentEnvironment.WORKSPACE_E2E_VERCEL_TOKEN,
  };
};

export type AgentEvalSettings = ReturnType<typeof makeAgentEvalSettings>;

/** One runtime per Playwright worker, with a two-connection database pool. */
export const makeAgentEvalRuntime = (datasourceConfig: DatasourceConfig) =>
  ManagedRuntime.make(
    Layer.mergeAll(
      WorkspaceE2EAccountResourceService.layer(datasourceConfig).pipe(
        Layer.provideMerge(E2EDatabase.layer(datasourceConfig))
      ),
      FetchHttpClient.layer
    )
  );

export type AgentEvalRuntime = ReturnType<typeof makeAgentEvalRuntime>;
