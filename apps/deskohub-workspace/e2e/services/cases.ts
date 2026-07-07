import { Context, type Effect, Layer } from "effect";
import { makeWorkspaceE2ECases, runWorkspaceE2ECases } from "../cases";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import type { CheckoutFlowState, WorkspaceE2ECase } from "../types";
import { effectifyPromise } from "./core";

interface IWorkspaceE2ECaseService {
  readonly makeCases: (input: {
    readonly config: WorkspaceE2EConfig;
    readonly datasourceConfig: DatasourceConfig;
    readonly deploymentId: string;
    readonly flowStates: CheckoutFlowState[];
    readonly run: Runner;
  }) => Effect.Effect<readonly WorkspaceE2ECase[], unknown>;
  readonly runCases: (input: {
    readonly artifactRoot: string;
    readonly cases: readonly WorkspaceE2ECase[];
    readonly run: Runner;
    readonly sessionPrefix: string;
  }) => Effect.Effect<void, unknown>;
}

export class WorkspaceE2ECaseService extends Context.Service<
  WorkspaceE2ECaseService,
  IWorkspaceE2ECaseService
>()("WorkspaceE2ECaseService") {
  static Live = Layer.succeed(this, {
    makeCases: (input) => effectifyPromise(() => makeWorkspaceE2ECases(input)),
    runCases: (input) => effectifyPromise(() => runWorkspaceE2ECases(input)),
  });
}
