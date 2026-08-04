import { Effect } from "effect";
import type { WorkspaceE2EEnvironment } from "./e2e-env";
import {
  makeWorkspaceE2ELive,
  WorkspaceE2ERunnerService,
} from "./services/runner";

export const makeWorkspaceE2E = (environment: WorkspaceE2EEnvironment) =>
  Effect.gen(function* () {
    const runner = yield* WorkspaceE2ERunnerService;
    yield* runner.run;
  }).pipe(Effect.provide(makeWorkspaceE2ELive(environment)));
