import { resolve } from "node:path";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Cause, Context, Effect, Exit, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { normalizePostgresConnectionUrl } from "../../db/postgres-connection-url";
import { WorkspaceE2EProviderVerificationPermitService } from "../coordination/provider-verification-permit.service";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { addDatabaseUrlRedactions } from "../runtime";
import type { CheckoutFlowState } from "../types";
import { WorkspaceE2ECaseService } from "./cases";
import { WorkspaceE2ECleanupService } from "./cleanup";
import {
  WorkspaceE2ECommandRunnerService,
  WorkspaceE2EConfigService,
  WorkspaceE2EPathService,
  WorkspaceE2ERedactionService,
} from "./core";
import { WorkspaceE2EPreviewReadinessService } from "./preview-readiness";
import { E2ERunContextService, E2ETelemetryService } from "./telemetry";

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
      const paths = yield* WorkspaceE2EPathService;
      const previewReadiness = yield* WorkspaceE2EPreviewReadinessService;
      const { value: runContext } = yield* E2ERunContextService;
      const telemetry = yield* E2ETelemetryService;

      return {
        run: telemetry.traceRun(
          Effect.gen(function* () {
            const config = yield* configService.getConfig;
            const run = yield* commandRunner.getRunner;
            const sessionPrefix = `workspace-checkout-e2e-${runContext.runId}`;
            const artifactRoot = resolve(
              paths.workspaceDir,
              "e2e-artifacts",
              sessionPrefix
            );
            const flowStates: CheckoutFlowState[] = [];
            const datasourceConfig = yield* configService.getDatasourceConfig;
            yield* configService.assertDatasourceSafety(datasourceConfig);
            yield* configService.assertNexiSandbox(
              datasourceConfig.nexiApiOrigin
            );

            yield* Effect.gen(function* () {
              const workflow = Effect.gen(function* () {
                yield* telemetry.tracePhase({
                  effect: previewReadiness.assertEndpoints(config),
                  phaseId: "preview-readiness",
                });

                const e2eCases = yield* cases.makeCases({
                  allocation: runContext.allocation,
                  config,
                  datasourceConfig,
                  flowStates,
                  run,
                });

                yield* cases.runCases({
                  artifactRoot,
                  cases: e2eCases,
                  datasourceConfig,
                  run,
                  sessionPrefix,
                  timeouts: config.timeouts,
                });
              });

              const workflowExit = yield* Effect.exit(workflow);
              const workflowError = Exit.isFailure(workflowExit)
                ? Cause.squash(workflowExit.cause)
                : undefined;
              const cleanupExit = yield* Effect.exit(
                telemetry.tracePhase({
                  effect: cleanup
                    .cleanupCheckoutStates({
                      datasourceConfig,
                      flowStates,
                      workflowError,
                    })
                    .pipe(
                      Effect.flatMap((cleanupError) =>
                        cleanupError ? Effect.fail(cleanupError) : Effect.void
                      )
                    ),
                  phaseId: "suite-cleanup",
                })
              );
              const cleanupError = Exit.isFailure(cleanupExit)
                ? toWorkspaceE2EError(
                    "clean up workspace e2e suite",
                    Cause.squash(cleanupExit.cause)
                  )
                : undefined;

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
            }).pipe(Effect.provide(E2EDatabase.layer(datasourceConfig)));
          })
        ),
      };
    })
  );
}

export const makeWorkspaceE2ELive = (environment: WorkspaceE2EEnvironment) => {
  addDatabaseUrlRedactions(
    environment.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL
  );

  const E2ETelemetryLive = E2ETelemetryService.Live.pipe(
    Layer.provideMerge(E2ERunContextService.layer(environment))
  );

  const WorkspaceE2EProviderPermitDatabaseLive =
    environment.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL
      ? PgClient.layer({
          applicationName: "workspace-e2e-provider-verification",
          connectTimeout: "10 seconds",
          maxConnections: 2,
          url: Redacted.make(
            normalizePostgresConnectionUrl(
              environment.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL
            )
          ),
        }).pipe(
          Layer.catch((cause) =>
            Layer.effect(
              PgClient.PgClient,
              Effect.fail(
                toWorkspaceE2EError(
                  "connect to provider permit coordination database",
                  cause
                )
              )
            )
          )
        )
      : undefined;

  const WorkspaceE2EProviderVerificationPermitLive =
    WorkspaceE2EProviderPermitDatabaseLive
      ? WorkspaceE2EProviderVerificationPermitService.Live.pipe(
          Layer.provide(WorkspaceE2EProviderPermitDatabaseLive)
        )
      : WorkspaceE2EProviderVerificationPermitService.SuiteLocal;

  const WorkspaceE2ECoreLive = Layer.mergeAll(
    FetchHttpClient.layer,
    WorkspaceE2EPathService.Live,
    WorkspaceE2ERedactionService.Live,
    WorkspaceE2EConfigService.layer(environment),
    WorkspaceE2ECleanupService.Live,
    WorkspaceE2EProviderVerificationPermitLive,
    E2ETelemetryLive
  );

  const WorkspaceE2ECaseLive = WorkspaceE2ECaseService.Live.pipe(
    Layer.provideMerge(WorkspaceE2ECoreLive)
  );

  const WorkspaceE2ECommandRunnerLive = WorkspaceE2ECommandRunnerService.layer(
    environment
  ).pipe(Layer.provideMerge(WorkspaceE2ECaseLive));

  const WorkspaceE2EPreviewReadinessLive =
    WorkspaceE2EPreviewReadinessService.Live.pipe(
      Layer.provideMerge(WorkspaceE2ECommandRunnerLive)
    );

  return WorkspaceE2ERunnerService.Live.pipe(
    Layer.provide(WorkspaceE2EPreviewReadinessLive)
  );
};
