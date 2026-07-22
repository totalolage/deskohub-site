import { NextEffect } from "@deskohub/next-effect";
import { Effect } from "effect";
import { WorkspaceLoggerLive } from "./logging/censorship";

const runtime = NextEffect.make({ layer: WorkspaceLoggerLive });

export const runStandaloneWorkspaceEffect = (operation: string) =>
  function runEffect<A, E>(effect: Effect.Effect<A, E, never>) {
    return runtime.run(
      effect.pipe(
        Effect.annotateLogs({
          boundary: "run",
          operation,
        })
      )
    );
  };
