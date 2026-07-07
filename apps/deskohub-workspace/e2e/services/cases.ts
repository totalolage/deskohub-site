import { Context, Effect, Layer } from "effect";
import { makeWorkspaceE2ECases, runWorkspaceE2ECases } from "../cases";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import type { CheckoutFlowState, WorkspaceE2ECase } from "../types";
import { WorkspaceE2EResourceService } from "./resources";

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
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const resources = yield* WorkspaceE2EResourceService;

      return {
        makeCases: (input) => makeWorkspaceE2ECases({ ...input, resources }),
        runCases: runWorkspaceE2ECases,
      };
    })
  );
}
