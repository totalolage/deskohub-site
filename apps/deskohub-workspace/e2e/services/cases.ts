import { Context, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import { makeWorkspaceE2ECases, type WorkspaceE2EPreparation } from "../cases";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { WorkspaceE2EProviderVerificationPermitService } from "../coordination/provider-verification-permit.service";
import type { WorkspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { Runner } from "../runtime";
import {
  runWorkspaceE2ECase,
  type WorkspaceE2EFailureReporter,
} from "../suite";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type { CheckoutFlowState, WorkspaceE2ECase } from "../types";
import { WorkspaceE2ECleanupService } from "./cleanup";
import { E2ETelemetryService } from "./telemetry";

interface IWorkspaceE2ECaseService {
  readonly makeCases: (input: {
    readonly allocation: WorkspaceE2EDateAllocation;
    readonly config: WorkspaceE2EConfig;
    readonly datasourceConfig: DatasourceConfig;
    readonly flowStates: CheckoutFlowState[];
    readonly preparation: WorkspaceE2EPreparation;
    readonly run: Runner;
  }) => Effect.Effect<readonly WorkspaceE2ECase[], WorkspaceE2EError>;
  readonly runCase: (input: {
    readonly artifactRoot: string;
    readonly datasourceConfig: DatasourceConfig;
    readonly reportFailure?: WorkspaceE2EFailureReporter;
    readonly run: Runner;
    readonly sessionPrefix: string;
    readonly testCase: WorkspaceE2ECase;
    readonly timeouts: WorkspaceE2ETimeouts;
  }) => Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;
}

export class WorkspaceE2ECaseService extends Context.Service<
  WorkspaceE2ECaseService,
  IWorkspaceE2ECaseService
>()("WorkspaceE2ECaseService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const cleanup = yield* WorkspaceE2ECleanupService;
      const providerVerificationPermit =
        yield* WorkspaceE2EProviderVerificationPermitService;
      const telemetry = yield* E2ETelemetryService;
      return {
        makeCases: (input) =>
          makeWorkspaceE2ECases(input).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.provideService(E2ETelemetryService, telemetry)
          ),
        runCase: (input) =>
          runWorkspaceE2ECase(input).pipe(
            Effect.provideService(WorkspaceE2ECleanupService, cleanup),
            Effect.provideService(
              WorkspaceE2EProviderVerificationPermitService,
              providerVerificationPermit
            ),
            Effect.provideService(E2ETelemetryService, telemetry)
          ),
      };
    })
  );
}
