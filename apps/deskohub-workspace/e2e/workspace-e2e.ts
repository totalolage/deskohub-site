import { Effect } from "effect";
import { WorkspaceE2ERunnerService } from "./services/runner";

export const workspaceE2E = Effect.gen(function* () {
  const runner = yield* WorkspaceE2ERunnerService;
  yield* runner.run;
});
