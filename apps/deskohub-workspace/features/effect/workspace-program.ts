import { Effect } from "effect";

export const workspaceStatusProgram: Effect.Effect<string> =
  Effect.succeed("Runtime ready");
