import { describe, expect, test } from "bun:test";
import { Effect } from "effect";

describe("standalone WorkspaceEffect composition", () => {
  test("imports and executes without a Next request or app telemetry setup", async () => {
    const { WorkspaceEffect } = await import("./standalone");

    await expect(
      WorkspaceEffect.run(
        { operation: "test.standalone" },
        Effect.succeed("ready")
      )
    ).resolves.toBe("ready");
  });
});
