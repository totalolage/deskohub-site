import { describe, expect, mock, spyOn, test } from "bun:test";
import { Deferred, Effect } from "effect";
import { redirect } from "next/navigation";
import { CENSORED_LOG_VALUE } from "@/shared/utils/log-classification";

const emitPostHogLog = mock(() => undefined);

mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: emitPostHogLog }),
  },
}));

const {
  defineWorkspacePage,
  defineWorkspaceTask,
  runWorkspaceEffect,
  runWorkspaceEffectOrElse,
} = await import("./workspace-effect");

describe("Workspace Effect execution", () => {
  test("provides the censored Workspace logger", async () => {
    const log = spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await Effect.logInfo("executed", { token: "private" }).pipe(
        runWorkspaceEffect("test.run")
      );

      expect(log).toHaveBeenCalledTimes(1);
      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain(CENSORED_LOG_VALUE);
      expect(output).not.toContain("private");
    } finally {
      log.mockRestore();
    }
  });

  test("emits logs through the provider exported by instrumentation", async () => {
    emitPostHogLog.mockClear();

    await Effect.logInfo("exported").pipe(
      runWorkspaceEffect("test.posthog-export")
    );

    expect(emitPostHogLog).toHaveBeenCalledTimes(1);
  });

  test("pages pass props into an Effect component", async () => {
    const page = defineWorkspacePage(
      "test.page",
      ({ slug }: { readonly slug: string }) => Effect.succeed(`page:${slug}`)
    );

    await expect(page({ slug: "sale" })).resolves.toBe("page:sale");
  });

  test("tasks serve no customer request, so their agent traffic is unclassified", async () => {
    const { CurrentAgentTraffic } = await import("./workspace-request-context");
    const task = defineWorkspaceTask("test.task-agent-traffic", () =>
      Effect.map(CurrentAgentTraffic, (traffic) => traffic)
    );

    await expect(task()).resolves.toEqual({ category: "unclassified" });
  });
});

describe("runWorkspaceEffect", () => {
  /**
   * Starts `effect` behind a gate under a Vercel request context and
   * returns the run with the promise it handed to `waitUntil`.
   */
  const startGatedRun = async <A, E>(effect: Effect.Effect<A, E, never>) => {
    const gate = Deferred.makeUnsafe<void>();
    const { promise: started, resolve } = Promise.withResolvers<void>();
    const registered: Promise<unknown>[] = [];
    const vercelRequestContext = Symbol.for("@vercel/request-context");
    const previousContext = Reflect.get(globalThis, vercelRequestContext);
    Reflect.set(globalThis, vercelRequestContext, {
      get: () => ({
        waitUntil: (promise: Promise<unknown>) => registered.push(promise),
      }),
    });

    try {
      const run = Effect.sync(resolve).pipe(
        Effect.andThen(Deferred.await(gate)),
        Effect.andThen(effect),
        runWorkspaceEffect("test.background")
      );
      await started;
      return {
        run,
        registered,
        release: () => Deferred.doneUnsafe(gate, Effect.void),
      };
    } finally {
      Reflect.set(globalThis, vercelRequestContext, previousContext);
    }
  };

  test("keeps the function alive until a successful run settles", async () => {
    const { run, registered, release } = await startGatedRun(
      Effect.succeed("loaded")
    );

    expect(registered).toHaveLength(1);
    expect(Bun.peek.status(registered[0])).toBe("pending");

    release();
    await expect(run).resolves.toBe("loaded");
    await expect(registered[0]).resolves.toBeUndefined();
  });

  test("keeps the function alive until a failing run settles, leaving the failure to the caller", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { run, registered, release } = await startGatedRun(
        Effect.fail("unavailable")
      );

      expect(registered).toHaveLength(1);
      expect(Bun.peek.status(registered[0])).toBe("pending");

      release();
      await expect(run).rejects.toBe("unavailable");
      await expect(registered[0]).resolves.toBeUndefined();
    } finally {
      error.mockRestore();
    }
  });
});

describe("runWorkspaceEffectOrElse", () => {
  const failureCode = "test.fallback_failed";

  const runWithFallback = async <A, E>(effect: Effect.Effect<A, E, never>) => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const orElse = mock(() => "fallback" as const);

    try {
      const result = await effect.pipe(
        runWorkspaceEffectOrElse("test.fallback", { failureCode, orElse })
      );
      return {
        result,
        orElse,
        warnings: warn.mock.calls.map((call) => call.join(" ")),
      };
    } finally {
      warn.mockRestore();
    }
  };

  test("returns the Effect's value without calling the fallback", async () => {
    const { result, orElse, warnings } = await runWithFallback(
      Effect.succeed("value")
    );

    expect(result).toBe("value");
    expect(orElse).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });

  test("falls back once on a typed failure and logs it once, censored", async () => {
    const failure = new Error("lookup failed for private-customer");
    const { result, orElse, warnings } = await runWithFallback(
      Effect.fail(failure)
    );

    expect(result).toBe("fallback");
    expect(orElse).toHaveBeenCalledTimes(1);
    expect(orElse).toHaveBeenCalledWith(failure);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(failureCode);
    expect(warnings[0]).toContain("test.fallback");
    expect(warnings[0]).not.toContain("private-customer");
  });

  test("falls back once on a defect and logs it once", async () => {
    const defect = new Error("unexpected private-defect");
    const { result, orElse, warnings } = await runWithFallback(
      Effect.die(defect)
    );

    expect(result).toBe("fallback");
    expect(orElse).toHaveBeenCalledTimes(1);
    expect(orElse).toHaveBeenCalledWith(defect);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(failureCode);
    expect(warnings[0]).not.toContain("private-defect");
  });

  test("propagates Next.js control flow without falling back or logging", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const orElse = mock(() => "fallback" as const);

    try {
      await expect(
        Effect.sync(() => redirect("/target")).pipe(
          runWorkspaceEffectOrElse("test.fallback", { failureCode, orElse })
        )
      ).rejects.toMatchObject({
        digest: expect.stringContaining("NEXT_REDIRECT"),
      });
      expect(orElse).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("rejects with the fallback's error, unlogged, when it rethrows", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = new Error("source failed");
    const onFailure = mock(() => undefined);

    try {
      await expect(
        Effect.fail(failure).pipe(
          runWorkspaceEffectOrElse("test.fallback", {
            failureCode,
            orElse: (cause) => {
              onFailure();
              throw cause;
            },
          })
        )
      ).rejects.toBe(failure);
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("serves the fallback once when the logger throws", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logger unavailable");
    });
    const orElse = mock(() => "fallback" as const);

    try {
      await expect(
        Effect.fail(new Error("lookup failed")).pipe(
          runWorkspaceEffectOrElse("test.fallback", { failureCode, orElse })
        )
      ).resolves.toBe("fallback");
      expect(orElse).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("propagates a pre-aborted signal like runWorkspaceEffect, without falling back or logging", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const orElse = mock(() => "fallback" as const);
    const controller = new AbortController();
    controller.abort();

    try {
      const expected = await settle(
        Effect.never.pipe(
          runWorkspaceEffect("test.fallback", { signal: controller.signal })
        )
      );
      const actual = await settle(
        Effect.never.pipe(
          runWorkspaceEffectOrElse("test.fallback", {
            failureCode,
            orElse,
            signal: controller.signal,
          })
        )
      );

      expect(expected.status).toBe("rejected");
      expect(actual).toEqual(expected);
      expect(orElse).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("propagates an abort during the run like runWorkspaceEffect, without falling back or logging", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const orElse = mock(() => "fallback" as const);

    const abortOnceStarted = async (
      run: (
        effect: Effect.Effect<never>,
        signal: AbortSignal
      ) => Promise<unknown>
    ) => {
      const controller = new AbortController();
      const { promise: started, resolve } = Promise.withResolvers<void>();
      const result = settle(
        run(
          Effect.sync(resolve).pipe(Effect.andThen(Effect.never)),
          controller.signal
        )
      );
      await started;
      controller.abort();
      return result;
    };

    try {
      const expected = await abortOnceStarted((effect, signal) =>
        effect.pipe(runWorkspaceEffect("test.fallback", { signal }))
      );
      const actual = await abortOnceStarted((effect, signal) =>
        effect.pipe(
          runWorkspaceEffectOrElse("test.fallback", {
            failureCode,
            orElse,
            signal,
          })
        )
      );

      expect(expected.status).toBe("rejected");
      expect(actual).toEqual(expected);
      expect(orElse).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

const settle = (promise: Promise<unknown>) =>
  promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: Error) => ({
      status: "rejected" as const,
      reason: { name: reason.name, message: reason.message },
    })
  );
