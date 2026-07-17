import { Context, type Effect, Layer } from "effect";
import { makeWorkspaceE2ECases } from "../cases";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { runWorkspaceE2ECases } from "../suite";
import type { CheckoutFlowState, WorkspaceE2ECase } from "../types";

interface IWorkspaceE2ECaseService {
  readonly makeCases: (input: {
    readonly config: WorkspaceE2EConfig;
    readonly datasourceConfig: DatasourceConfig;
    readonly deploymentId: string;
    readonly flowStates: CheckoutFlowState[];
    readonly run: Runner;
  }) => Effect.Effect<readonly WorkspaceE2ECase[], WorkspaceE2EError>;
  readonly runCases: (input: {
    readonly artifactRoot: string;
    readonly cases: readonly WorkspaceE2ECase[];
    readonly run: Runner;
    readonly sessionPrefix: string;
  }) => Effect.Effect<void, WorkspaceE2EError>;
}

export class WorkspaceE2ECaseService extends Context.Service<
  WorkspaceE2ECaseService,
  IWorkspaceE2ECaseService
>()("WorkspaceE2ECaseService") {
  static Live = Layer.succeed(this, {
    makeCases: makeWorkspaceE2ECases,
    runCases: runWorkspaceE2ECases,
  });
}
