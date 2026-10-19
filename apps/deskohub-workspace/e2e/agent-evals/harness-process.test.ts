import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { AgentEvalHarness, AgentEvalRequest } from "./harness-contract";
import { runAgentEvalHarness } from "./harness-process";

const stubHarnessPath = fileURLToPath(
  new URL("./harness.stub-fixture.ts", import.meta.url)
);

const request: AgentEvalRequest = {
  cdpEndpoint: "http://127.0.0.1:9",
  locale: "cs-CZ",
  outputDir: "/nonexistent",
  prompt: "Open the start page.",
  startUrl: "https://example.invalid/cs-CZ",
  taskId: "facts",
  timeoutMs: 1_000,
  version: 1,
};

const stubHarness = (mode: string): AgentEvalHarness => ({
  command: [process.execPath, stubHarnessPath, mode],
  id: "stub",
  perception: "accessibility-tree",
});

const run = (harness: AgentEvalHarness, killAfterMs = 20_000) =>
  Effect.runPromise(
    runAgentEvalHarness({
      harness,
      harnessDirectory: process.cwd(),
      killAfterMs,
      request,
    })
  );

describe("runAgentEvalHarness", () => {
  test("hands the request to the harness on stdin and reads its response", async () => {
    const result = await run(stubHarness("answer"));

    expect(result.outcome).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.response).toEqual({
      costUsd: 0.25,
      finalAnswer: "facts cs-CZ",
      steps: 3,
    });
    expect(result.stderr).toContain("stub harness received facts");
  });

  test("records an agent that reports an error, whatever its exit code", async () => {
    const result = await run(stubHarness("agent-error"));

    expect(result.outcome).toBe("agent-error");
    expect(result.exitCode).toBe(2);
    expect(result.response?.error).toBe("gave up");
  });

  test("rejects anything but one JSON object on stdout", async () => {
    const result = await run(stubHarness("noisy-stdout"));

    expect(result.outcome).toBe("invalid-response");
    expect(result.response).toBeUndefined();
  });

  test("records a nonzero exit without a response", async () => {
    const result = await run(stubHarness("exit"));

    expect(result.outcome).toBe("exit");
    expect(result.exitCode).toBe(3);
  });

  test("kills a harness that outlives its budget", async () => {
    const startedAt = performance.now();
    const result = await run(stubHarness("hang"), 1_000);

    expect(result.outcome).toBe("timeout");
    expect(performance.now() - startedAt).toBeLessThan(15_000);
  });

  test("records a command that cannot start", async () => {
    const result = await run({
      command: ["./missing-agent-eval-harness"],
      id: "missing",
      perception: "screenshot",
    });

    expect(result.outcome).toBe("spawn-failure");
  });
});
