import { Context, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";
import { makeWorkspaceE2ECases } from "../cases";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { runWorkspaceE2ECases } from "../suite";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type { CheckoutFlowState, WorkspaceE2ECase } from "../types";
import { E2ETelemetryService } from "./telemetry";

interface IWorkspaceE2ECaseService {
  readonly makeCases: (input: {
    readonly config: WorkspaceE2EConfig;
    readonly datasourceConfig: DatasourceConfig;
    readonly flowStates: CheckoutFlowState[];
    readonly run: Runner;
  }) => Effect.Effect<readonly WorkspaceE2ECase[], WorkspaceE2EError>;
  readonly runCases: (input: {
    readonly artifactRoot: string;
    readonly cases: readonly WorkspaceE2ECase[];
    readonly run: Runner;
    readonly sessionPrefix: string;
    readonly timeouts: WorkspaceE2ETimeouts;
  }) => Effect.Effect<void, WorkspaceE2EError>;
}

export class WorkspaceE2ECaseService extends Context.Service<
  WorkspaceE2ECaseService,
  IWorkspaceE2ECaseService
>()("WorkspaceE2ECaseService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const telemetry = yield* E2ETelemetryService;
      return {
        makeCases: (input) =>
          makeWorkspaceE2ECases(input).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient)
          ),
        runCases: (input) =>
          runWorkspaceE2ECases(input).pipe(
            Effect.provideService(E2ETelemetryService, telemetry)
          ),
      };
    })
  );
}
