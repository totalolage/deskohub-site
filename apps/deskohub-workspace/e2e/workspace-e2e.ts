import { Effect } from "effect";
import { WorkspaceE2ELive, WorkspaceE2ERunnerService } from "./services/runner";

export const workspaceE2E = Effect.gen(function* () {
  const runner = yield* WorkspaceE2ERunnerService;
  yield* runner.run;
}).pipe(Effect.provide(WorkspaceE2ELive));
