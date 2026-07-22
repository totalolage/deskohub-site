import { describe, expect, spyOn, test } from "bun:test";
import { EffectBoundary } from "@deskohub/next-effect/effect-boundary";
import { Effect } from "effect";
import { CENSORED_LOG_VALUE, WorkspaceLoggerLive } from "./logging/censorship";

describe("Workspace Effect executor composition", () => {
  test("provides one censored logger composition", async () => {
    const log = spyOn(console, "info").mockImplementation(() => undefined);
    const executor = EffectBoundary.makeExecutor({
      transform: (effect) => Effect.provide(effect, WorkspaceLoggerLive),
    });

    try {
      await executor.runExit(Effect.logInfo("executed", { token: "private" }));

      expect(log).toHaveBeenCalledTimes(1);
      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain(CENSORED_LOG_VALUE);
      expect(output).not.toContain("private");
    } finally {
      log.mockRestore();
    }
  });
});
