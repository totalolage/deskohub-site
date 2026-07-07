import { resolve } from "node:path";
import {
  cleanupCheckoutFlowStates,
  makeWorkspaceE2ECases,
  runWorkspaceE2ECases,
} from "./cases";
import {
  assertNexiSandbox,
  getConfig,
  getDatasourceConfig,
  getVercelDeployEnvArgs,
} from "./config";
import {
  assertSafeDatabaseUrl,
  extractDeploymentUrl,
  loadEnvFile,
  makeRunner,
  repoRoot,
  workspaceDir,
} from "./runtime";
import type { CheckoutFlowState } from "./types";
import {
  assertWebhookEndpoint,
  assignAlias,
  getDeployment,
  recordAliasPreflight,
  verifyAlias,
  writeVercelProjectLink,
} from "./vercel";

export const runWorkspaceE2E = async () => {
  await loadEnvFile(resolve(workspaceDir, ".env.local"));

  const config = getConfig();
  const run = makeRunner(config);
  const sessionPrefix = `workspace-checkout-e2e-${Date.now()}`;
  const artifactRoot = resolve(workspaceDir, "e2e-artifacts", sessionPrefix);
  let datasourceConfig: ReturnType<typeof getDatasourceConfig> | undefined;
  const flowStates: CheckoutFlowState[] = [];
  let cleanupError: unknown;
  let workflowError: unknown;

  try {
    await writeVercelProjectLink(config);
    await run("git", ["status", "--short"], { cwd: repoRoot });
    await run("bunx", [
      "vercel@latest",
      "pull",
      "--yes",
      "--environment=preview",
      "--cwd",
      repoRoot,
      "--token",
      config.vercelToken,
    ]);
    await loadEnvFile(resolve(repoRoot, ".vercel/.env.preview.local"));
    datasourceConfig = getDatasourceConfig();
    assertSafeDatabaseUrl(datasourceConfig.databaseUrl, "DATABASE_URL");
    assertSafeDatabaseUrl(
      datasourceConfig.databaseUrlUnpooled,
      "DATABASE_URL_UNPOOLED"
    );
    assertNexiSandbox(datasourceConfig.nexiApiOrigin);

    const deploy = await run(
      "bunx",
      [
        "vercel@latest",
        "deploy",
        "--yes",
        "--force",
        "--archive=tgz",
        "--cwd",
        repoRoot,
        ...getVercelDeployEnvArgs(config, datasourceConfig),
        "--token",
        config.vercelToken,
      ],
      { timeoutMs: 20 * 60 * 1000 }
    );
    const previewUrl = extractDeploymentUrl(deploy.stdout);
    const deployment = await getDeployment(config, previewUrl);

    if (await recordAliasPreflight(config, deployment.id))
      await assignAlias(config, deployment.id);
    await verifyAlias(config, deployment.id);
    await assertWebhookEndpoint(config, "/api/webhooks/nexi");
    await assertWebhookEndpoint(config, "/api/webhooks/resend");

    const cases = await makeWorkspaceE2ECases({
      config,
      datasourceConfig,
      deploymentId: deployment.id,
      flowStates,
      run,
    });

    await runWorkspaceE2ECases({ artifactRoot, cases, run, sessionPrefix });
  } catch (cause) {
    workflowError = cause;
  } finally {
    cleanupError = await cleanupCheckoutFlowStates({
      datasourceConfig,
      flowStates,
      workflowError,
    });
  }

  if (workflowError) throw workflowError;
  if (cleanupError) throw cleanupError;
};
