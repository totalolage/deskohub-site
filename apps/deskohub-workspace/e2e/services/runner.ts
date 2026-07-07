import { resolve } from "node:path";
import { Cause, Context, Effect, Exit, Layer } from "effect";
import type { DatasourceConfig } from "../config";
import { toWorkspaceE2EError, type WorkspaceE2EError } from "../errors";
import type { CheckoutFlowState } from "../types";
import { WorkspaceE2ECaseService } from "./cases";
import { WorkspaceE2ECleanupService } from "./cleanup";
import {
  WorkspaceE2ECommandRunnerService,
  WorkspaceE2EConfigService,
  WorkspaceE2EEnvFileService,
  WorkspaceE2EPathService,
  WorkspaceE2ERedactionService,
} from "./core";
import { WorkspaceE2EResourceService } from "./resources";
import { WorkspaceE2EVercelPreviewService } from "./vercel-preview";

interface IWorkspaceE2ERunnerService {
  readonly run: Effect.Effect<void, WorkspaceE2EError>;
}

export class WorkspaceE2ERunnerService extends Context.Service<
  WorkspaceE2ERunnerService,
  IWorkspaceE2ERunnerService
>()("WorkspaceE2ERunnerService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const cases = yield* WorkspaceE2ECaseService;
      const cleanup = yield* WorkspaceE2ECleanupService;
      const commandRunner = yield* WorkspaceE2ECommandRunnerService;
      const configService = yield* WorkspaceE2EConfigService;
      const envFiles = yield* WorkspaceE2EEnvFileService;
      const paths = yield* WorkspaceE2EPathService;
      const vercel = yield* WorkspaceE2EVercelPreviewService;

      return {
        run: Effect.gen(function* () {
          yield* envFiles.loadLocalEnv;

          const config = yield* configService.getConfig;
          const run = yield* commandRunner.getRunner;
          const sessionPrefix = `workspace-checkout-e2e-${Date.now()}`;
          const artifactRoot = resolve(
            paths.workspaceDir,
            "e2e-artifacts",
            sessionPrefix
          );
          const flowStates: CheckoutFlowState[] = [];
          let datasourceConfig: DatasourceConfig | undefined;

          const workflow = Effect.gen(function* () {
            yield* vercel.pullPreviewEnv(config);

            datasourceConfig = yield* configService.getDatasourceConfig;
            yield* configService.assertDatasourceSafety(datasourceConfig);
            yield* configService.assertNexiSandbox(
              datasourceConfig.nexiApiOrigin
            );

            const deployment = yield* vercel.deployFreshPreview(
              config,
              datasourceConfig
            );
            yield* vercel.prepareAlias(config, deployment.id);
            yield* vercel.assertWebhookEndpoints(config);

            const e2eCases = yield* cases.makeCases({
              config: deployment.testConfig,
              datasourceConfig,
              deploymentId: deployment.id,
              flowStates,
              run,
            });

            yield* cases.runCases({
              artifactRoot,
              cases: e2eCases,
              run,
              sessionPrefix,
            });
          });

          const workflowExit = yield* Effect.exit(workflow);
          const workflowError = Exit.isFailure(workflowExit)
            ? Cause.squash(workflowExit.cause)
            : undefined;
          const cleanupError = yield* cleanup.cleanupCheckoutStates({
            datasourceConfig,
            flowStates,
            workflowError,
          });

          if (Exit.isFailure(workflowExit))
            return yield* Effect.fail(
              toWorkspaceE2EError(
                "run workspace e2e workflow",
                Cause.squash(workflowExit.cause)
              )
            );
          if (cleanupError) return yield* Effect.fail(cleanupError);
        }),
      };
    })
  );
}

const WorkspaceE2ECoreLive = Layer.mergeAll(
  WorkspaceE2EPathService.Live,
  WorkspaceE2ERedactionService.Live,
  WorkspaceE2EConfigService.Live,
  WorkspaceE2EResourceService.Live,
  WorkspaceE2ECleanupService.Live
);

const WorkspaceE2ECaseLive = WorkspaceE2ECaseService.Live.pipe(
  Layer.provideMerge(WorkspaceE2ECoreLive)
);

const WorkspaceE2EEnvFileLive = WorkspaceE2EEnvFileService.Live.pipe(
  Layer.provideMerge(WorkspaceE2ECaseLive)
);

const WorkspaceE2ECommandRunnerLive =
  WorkspaceE2ECommandRunnerService.Live.pipe(
    Layer.provideMerge(WorkspaceE2EEnvFileLive)
  );

const WorkspaceE2EVercelPreviewLive =
  WorkspaceE2EVercelPreviewService.Live.pipe(
    Layer.provideMerge(WorkspaceE2ECommandRunnerLive)
  );

export const WorkspaceE2ELive = WorkspaceE2ERunnerService.Live.pipe(
  Layer.provide(WorkspaceE2EVercelPreviewLive)
);
