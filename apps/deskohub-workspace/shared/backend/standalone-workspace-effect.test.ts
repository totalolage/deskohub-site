import { describe, expect, test } from "bun:test";
import { Effect } from "effect";

describe("standalone Workspace Effect execution", () => {
  test("runs without a Next request or app telemetry setup", async () => {
    const { runStandaloneWorkspaceEffect } = await import(
      "./standalone-workspace-effect"
    );

    await expect(
      Effect.succeed("ready").pipe(
        runStandaloneWorkspaceEffect("test.standalone")
      )
    ).resolves.toBe("ready");
  });
});
