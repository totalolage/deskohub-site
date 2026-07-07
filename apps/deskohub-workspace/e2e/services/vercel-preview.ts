import { Context, Effect, Layer } from "effect";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  effectifyPromise,
  effectifySync,
  type WorkspaceE2EError,
} from "../errors";
import { extractDeploymentUrl } from "../runtime";
import {
  assertWebhookEndpoint,
  assignAlias,
  getDeployment,
  recordAliasPreflight,
  verifyAlias,
  writeVercelProjectLink,
} from "../vercel";
import {
  WorkspaceE2ECommandRunnerService,
  WorkspaceE2EConfigService,
  WorkspaceE2EEnvFileService,
  WorkspaceE2EPathService,
} from "./core";

export type WorkspaceE2EPreviewDeployment = {
  readonly id: string;
  readonly previewUrl: string;
  readonly testConfig: WorkspaceE2EConfig;
};

interface IWorkspaceE2EVercelPreviewService {
  readonly assertWebhookEndpoints: (
    config: WorkspaceE2EConfig
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly deployFreshPreview: (
    config: WorkspaceE2EConfig,
    datasourceConfig: DatasourceConfig
  ) => Effect.Effect<WorkspaceE2EPreviewDeployment, WorkspaceE2EError>;
  readonly prepareAlias: (
    config: WorkspaceE2EConfig,
    deploymentId: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly pullPreviewEnv: (
    config: WorkspaceE2EConfig
  ) => Effect.Effect<void, WorkspaceE2EError>;
}

export class WorkspaceE2EVercelPreviewService extends Context.Service<
  WorkspaceE2EVercelPreviewService,
  IWorkspaceE2EVercelPreviewService
>()("WorkspaceE2EVercelPreviewService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const commandRunner = yield* WorkspaceE2ECommandRunnerService;
      const configService = yield* WorkspaceE2EConfigService;
      const envFiles = yield* WorkspaceE2EEnvFileService;
      const paths = yield* WorkspaceE2EPathService;

      return {
        assertWebhookEndpoints: (config) =>
          Effect.gen(function* () {
            yield* effectifyPromise("check Nexi webhook endpoint", () =>
              assertWebhookEndpoint(config, "/api/webhooks/nexi")
            );
            yield* effectifyPromise("check Resend webhook endpoint", () =>
              assertWebhookEndpoint(config, "/api/webhooks/resend")
            );
          }),
        deployFreshPreview: (config, datasourceConfig) =>
          Effect.gen(function* () {
            const deploy = yield* commandRunner.run(
              "bunx",
              [
                "vercel@latest",
                "deploy",
                "--yes",
                "--force",
                "--archive=tgz",
                "--cwd",
                paths.repoRoot,
                ...configService.getVercelDeployEnvArgs(
                  config,
                  datasourceConfig
                ),
                "--token",
                config.vercelToken,
              ],
              { timeoutMs: configService.getVercelDeployTimeoutMs() }
            );
            const previewUrl = yield* effectifySync(
              "extract Vercel deployment URL",
              () => extractDeploymentUrl(deploy.stdout)
            );
            const deployment = yield* effectifyPromise(
              "read Vercel deployment",
              () => getDeployment(config, previewUrl)
            );

            return {
              id: deployment.id,
              previewUrl,
              testConfig: { ...config, browserUrl: previewUrl },
            };
          }),
        prepareAlias: (config, deploymentId) =>
          Effect.gen(function* () {
            const shouldAssign = yield* effectifyPromise(
              "record Vercel alias preflight",
              () => recordAliasPreflight(config, deploymentId)
            );
            if (shouldAssign)
              yield* effectifyPromise("assign Vercel alias", () =>
                assignAlias(config, deploymentId)
              );
            yield* effectifyPromise("verify Vercel alias", () =>
              verifyAlias(config, deploymentId)
            );
          }),
        pullPreviewEnv: (config) =>
          Effect.gen(function* () {
            yield* effectifyPromise("write Vercel project link", () =>
              writeVercelProjectLink(config)
            );
            yield* commandRunner.run("git", ["status", "--short"], {
              cwd: paths.repoRoot,
            });
            yield* commandRunner.run("bunx", [
              "vercel@latest",
              "pull",
              "--yes",
              "--environment=preview",
              "--cwd",
              paths.repoRoot,
              "--token",
              config.vercelToken,
            ]);
            yield* envFiles.loadPreviewEnv;
          }),
      };
    })
  );
}
