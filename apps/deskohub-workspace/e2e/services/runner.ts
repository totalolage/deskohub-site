import { resolve } from "node:path";
import { Cause, Context, Effect, Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { DatasourceConfig } from "../config";
import type { E2EEnvironment } from "../e2e-env";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
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
import { WorkspaceE2EPreviewReadinessService } from "./preview-readiness";
import {
  E2ERunContextService,
  E2ETelemetryService,
  withE2ERunTelemetry,
} from "./telemetry";

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
      const previewReadiness = yield* WorkspaceE2EPreviewReadinessService;
      const { value: runContext } = yield* E2ERunContextService;
      const telemetry = yield* E2ETelemetryService;

      return {
        run: withE2ERunTelemetry(
          Effect.gen(function* () {
            yield* envFiles.loadLocalEnv;

            const config = yield* configService.getConfig;
            const run = yield* commandRunner.getRunner;
            const sessionPrefix = `workspace-checkout-e2e-${runContext.runId}`;
            const artifactRoot = resolve(
              paths.workspaceDir,
              "e2e-artifacts",
              sessionPrefix
            );
            const flowStates: CheckoutFlowState[] = [];
            let datasourceConfig: DatasourceConfig | undefined;

            const workflow = Effect.gen(function* () {
              datasourceConfig = yield* configService.getDatasourceConfig;
              yield* configService.assertDatasourceSafety(datasourceConfig);
              yield* configService.assertNexiSandbox(
                datasourceConfig.nexiApiOrigin
              );
              yield* previewReadiness.assertWebhookEndpoints(config);

              const e2eCases = yield* cases.makeCases({
                config,
                datasourceConfig,
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

            if (Exit.isFailure(workflowExit)) {
              const workflowFailure = toWorkspaceE2EError(
                "run workspace e2e workflow",
                Cause.squash(workflowExit.cause)
              );
              return yield* cleanupError
                ? workspaceE2EError(
                    "Workspace e2e workflow and cleanup failed",
                    {
                      causes: [workflowFailure, cleanupError],
                      operation: "run workspace e2e workflow",
                    }
                  )
                : workflowFailure;
            }
            if (cleanupError) return yield* cleanupError;
          }),
          telemetry
        ),
      };
    })
  );
}

export const makeWorkspaceE2ELive = (environment: E2EEnvironment) => {
  const E2ETelemetryLive = E2ETelemetryService.Live.pipe(
    Layer.provideMerge(E2ERunContextService.layer(environment))
  );

  const WorkspaceE2ECoreLive = Layer.mergeAll(
    FetchHttpClient.layer,
    WorkspaceE2EPathService.Live,
    WorkspaceE2ERedactionService.Live,
    WorkspaceE2EConfigService.Live,
    WorkspaceE2ECleanupService.Live,
    E2ETelemetryLive
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

  const WorkspaceE2EPreviewReadinessLive =
    WorkspaceE2EPreviewReadinessService.Live.pipe(
      Layer.provideMerge(WorkspaceE2ECommandRunnerLive)
    );

  return WorkspaceE2ERunnerService.Live.pipe(
    Layer.provide(WorkspaceE2EPreviewReadinessLive)
  );
};
