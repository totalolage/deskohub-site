import { Context, Effect, Layer } from "effect";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
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
  effectifyPromise,
  effectifySync,
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
  ) => Effect.Effect<void, unknown>;
  readonly deployFreshPreview: (
    config: WorkspaceE2EConfig,
    datasourceConfig: DatasourceConfig
  ) => Effect.Effect<WorkspaceE2EPreviewDeployment, unknown>;
  readonly prepareAlias: (
    config: WorkspaceE2EConfig,
    deploymentId: string
  ) => Effect.Effect<void, unknown>;
  readonly pullPreviewEnv: (
    config: WorkspaceE2EConfig
  ) => Effect.Effect<void, unknown>;
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
            yield* effectifyPromise(() =>
              assertWebhookEndpoint(config, "/api/webhooks/nexi")
            );
            yield* effectifyPromise(() =>
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
            const previewUrl = yield* effectifySync(() =>
              extractDeploymentUrl(deploy.stdout)
            );
            const deployment = yield* effectifyPromise(() =>
              getDeployment(config, previewUrl)
            );

            return {
              id: deployment.id,
              previewUrl,
              testConfig: { ...config, browserUrl: previewUrl },
            };
          }),
        prepareAlias: (config, deploymentId) =>
          Effect.gen(function* () {
            const shouldAssign = yield* effectifyPromise(() =>
              recordAliasPreflight(config, deploymentId)
            );
            if (shouldAssign)
              yield* effectifyPromise(() => assignAlias(config, deploymentId));
            yield* effectifyPromise(() => verifyAlias(config, deploymentId));
          }),
        pullPreviewEnv: (config) =>
          Effect.gen(function* () {
            yield* effectifyPromise(() => writeVercelProjectLink(config));
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
