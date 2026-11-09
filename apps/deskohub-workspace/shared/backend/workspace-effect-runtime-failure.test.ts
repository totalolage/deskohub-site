import { expect, mock, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { failWorkspaceTelemetry } from "@/shared/testing/workspace-telemetry.test-utils";

const runtimeBuildFailure = new Error(
  "synthetic PostHog logging configuration unusable"
);

// The shared runtime builds its observability layer before entering any
// Effect, so this fails every run in this file before the program starts.
failWorkspaceTelemetry(runtimeBuildFailure);

const { runWorkspaceEffect, runWorkspaceEffectOrElse } = await import(
  "./workspace-effect"
);

test("runWorkspaceEffect rejects before entering the Effect when the runtime cannot be built", async () => {
  const program = mock(() => "value");

  await expect(
    Effect.sync(program).pipe(runWorkspaceEffect("test.runtime-failure"))
  ).rejects.toBe(runtimeBuildFailure);
  expect(program).not.toHaveBeenCalled();
});

test("runWorkspaceEffectOrElse falls back once and logs once when the runtime cannot be built", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  const program = mock(() => "value");
  const orElse = mock(() => "fallback" as const);

  try {
    const result = await Effect.sync(program).pipe(
      runWorkspaceEffectOrElse("test.runtime-failure", {
        failureCode: "test.runtime_failure",
        orElse,
      })
    );

    expect(result).toBe("fallback");
    expect(program).not.toHaveBeenCalled();
    expect(orElse).toHaveBeenCalledTimes(1);
    expect(orElse).toHaveBeenCalledWith(runtimeBuildFailure);
    expect(warn).toHaveBeenCalledTimes(1);
    const output = warn.mock.calls.flat().join(" ");
    expect(output).toContain("test.runtime_failure");
    expect(output).toContain("test.runtime-failure");
  } finally {
    warn.mockRestore();
  }
});

test("runWorkspaceEffectOrElse rejects unlogged with the fallback's error when it rethrows after a runtime build failure", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  const onFailure = mock(() => undefined);

  try {
    await expect(
      Effect.succeed("value").pipe(
        runWorkspaceEffectOrElse("test.runtime-failure", {
          failureCode: "test.runtime_failure",
          orElse: (cause) => {
            onFailure();
            throw cause;
          },
        })
      )
    ).rejects.toBe(runtimeBuildFailure);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("runWorkspaceEffectOrElse serves the fallback once when the standalone logger throws after a runtime build failure", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {
    throw new Error("logger unavailable");
  });
  const orElse = mock(() => "fallback" as const);

  try {
    await expect(
      Effect.succeed("value").pipe(
        runWorkspaceEffectOrElse("test.runtime-failure", {
          failureCode: "test.runtime_failure",
          orElse,
        })
      )
    ).resolves.toBe("fallback");
    expect(orElse).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});

test("runWorkspaceEffectOrElse propagates a pre-aborted signal instead of answering a runtime build failure", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  const orElse = mock(() => "fallback" as const);
  const controller = new AbortController();
  controller.abort();

  try {
    await expect(
      Effect.succeed("value").pipe(
        runWorkspaceEffectOrElse("test.runtime-failure", {
          failureCode: "test.runtime_failure",
          orElse,
          signal: controller.signal,
        })
      )
    ).rejects.toBeDefined();
    expect(orElse).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});
