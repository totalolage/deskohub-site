import { describe, expect, mock, spyOn, test } from "bun:test";
import { Cause, Context, Deferred, Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
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
  catchRecoverableCause,
  defineWorkspaceTask,
  findNextControlFlow,
  runWorkspaceEffect,
  runWorkspaceEffectOrElse,
  toWorkspaceWebHandler,
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

describe("catchRecoverableCause", () => {
  const redirectError = Effect.runSync(
    Effect.flip(
      Effect.try({ try: () => redirect("/target"), catch: (thrown) => thrown })
    )
  );
  const recover = catchRecoverableCause(() => Effect.succeed("fallback"));

  test("answers typed failures and defects", async () => {
    for (const cause of [
      Cause.fail("broken"),
      Cause.die(new Error("crashed")),
    ]) {
      await expect(
        Effect.runPromise(Effect.failCause(cause).pipe(recover))
      ).resolves.toBe("fallback");
    }
  });

  test("keeps Next.js control flow that sits beside a typed failure", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.failCause(
        Cause.combine(Cause.fail("broken"), Cause.die(redirectError))
      ).pipe(recover)
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(findNextControlFlow(exit.cause)).toBe(redirectError);
      expect(Cause.hasFails(exit.cause)).toBe(false);
    }
  });

  test("lets interruption through", async () => {
    const exit = await Effect.runPromiseExit(Effect.interrupt.pipe(recover));

    expect(exit._tag === "Failure" && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true
    );
  });
});

describe("toWorkspaceWebHandler", () => {
  class RequestCaller extends Context.Service<
    RequestCaller,
    { readonly name: string }
  >()("test/RequestCaller") {}

  /** Provides each request the caller its `x-caller` header names. */
  const CallerFromRequest = HttpRouter.middleware<{
    provides: RequestCaller;
  }>()(
    Effect.succeed((httpEffect) =>
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
        Effect.provideService(httpEffect, RequestCaller, {
          name: request.headers["x-caller"] ?? "anonymous",
        })
      )
    )
  ).layer;

  const request = (path: string, caller: string) =>
    new Request(`https://workspace.deskohub.test${path}`, {
      headers: { "x-caller": caller },
    });

  test("keeps each of several concurrent requests' services its own over one shared build", async () => {
    const callers = ["ada", "bea", "cyd", "dov", "eli"];
    const later = "fay";
    let ledgerBuilds = 0;
    class SharedLedger extends Context.Service<
      SharedLedger,
      { readonly entries: string[] }
    >()("test/SharedLedger") {
      static Live = Layer.sync(this, () => {
        ledgerBuilds += 1;
        return { entries: [] };
      });
    }
    const entered = Object.fromEntries(
      callers.map((caller) => [caller, Promise.withResolvers<void>()])
    );
    const released = Object.fromEntries(
      [...callers, later].map((caller) => [
        caller,
        Promise.withResolvers<void>(),
      ])
    );
    const handle = toWorkspaceWebHandler(
      HttpRouter.add(
        "GET",
        "/caller",
        Effect.gen(function* () {
          const { name } = yield* RequestCaller;
          const ledger = yield* SharedLedger;
          ledger.entries.push(name);
          entered[name]?.resolve();
          const release = released[name];
          if (release === undefined) return yield* Effect.die(name);
          // Every other request enters, and its middleware runs, meanwhile.
          yield* Effect.promise(() => release.promise);
          const caller = yield* RequestCaller;
          return HttpServerResponse.jsonUnsafe({
            before: name,
            after: caller.name,
            seen: ledger.entries.length,
          });
        })
      ).pipe(
        HttpRouter.provideRequest(SharedLedger.Live),
        Layer.provide(CallerFromRequest)
      )
    );

    // All start before the handler's Layer is built.
    const responses = callers.map((caller) =>
      handle(request("/caller", caller))
    );
    await Promise.all(callers.map((caller) => entered[caller]?.promise));
    for (const caller of [...callers].reverse()) released[caller]?.resolve();

    const answers = await Promise.all(
      responses.map(async (response) => {
        const answered = await response;
        return { status: answered.status, body: await answered.json() };
      })
    );
    expect(answers).toEqual(
      callers.map((caller) => ({
        status: 200,
        body: { before: caller, after: caller, seen: callers.length },
      }))
    );
    expect(ledgerBuilds).toBe(1);

    released[later]?.resolve();
    const laterResponse = await handle(request("/caller", later));
    expect(await laterResponse.json()).toEqual({
      before: later,
      after: later,
      seen: callers.length + 1,
    });
    expect(ledgerBuilds).toBe(1);
  });

  test("keeps the Layers it builds from later runs, which build them per run", async () => {
    let builds = 0;
    class Instance extends Context.Service<Instance, { readonly id: number }>()(
      "test/Instance"
    ) {
      static Live = Layer.sync(this, () => {
        builds += 1;
        return { id: builds };
      });
    }
    const handle = toWorkspaceWebHandler(
      HttpRouter.add(
        "GET",
        "/instance",
        Effect.map(Instance, ({ id }) => HttpServerResponse.text(`${id}`))
      ).pipe(HttpRouter.provideRequest(Instance.Live))
    );
    const runInstance = () =>
      Effect.map(Instance, ({ id }) => id).pipe(
        Effect.provide(Instance.Live),
        runWorkspaceEffect("test.instance")
      );

    const served = await (await handle(request("/instance", "ada"))).text();
    expect(served).toBe("1");
    expect([await runInstance(), await runInstance()]).toEqual([2, 3]);
    expect(await (await handle(request("/instance", "bea"))).text()).toBe("1");
  });

  test("logs a handler's requests through the censored Workspace logger", async () => {
    const log = spyOn(console, "info").mockImplementation(() => undefined);
    const handle = toWorkspaceWebHandler(
      HttpRouter.add(
        "GET",
        "/logged",
        Effect.as(
          Effect.logInfo("handled", { token: "private" }),
          HttpServerResponse.empty()
        )
      )
    );

    try {
      expect((await handle(request("/logged", "ada"))).status).toBe(204);
      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain("handled");
      expect(output).toContain(CENSORED_LOG_VALUE);
      expect(output).not.toContain("private");
    } finally {
      log.mockRestore();
    }
  });

  test("keeps each handler's routes and global middleware to itself", async () => {
    const answering = (name: string) =>
      Layer.mergeAll(
        HttpRouter.add(
          "GET",
          `/${name}`,
          Effect.map(RequestCaller, (caller) =>
            HttpServerResponse.text(`${name} answered ${caller.name}`)
          )
        ).pipe(Layer.provide(CallerFromRequest)),
        HttpRouter.middleware(
          Effect.map(HttpServerResponse.setHeader("x-handler", name)),
          { global: true }
        )
      );
    const first = toWorkspaceWebHandler(answering("first"));
    const second = toWorkspaceWebHandler(answering("second"));

    const requests = [
      [first, "/first", "ada"],
      [second, "/second", "bea"],
      [first, "/second", "cyd"],
      [second, "/first", "dov"],
    ] as const;
    const answers = await Promise.all(
      requests.map(async ([handle, path, caller]) => {
        const response = await handle(request(path, caller));
        return [
          path,
          response.status,
          response.headers.get("x-handler"),
          response.status === 200 ? await response.text() : null,
        ];
      })
    );

    expect(answers).toEqual([
      ["/first", 200, "first", "first answered ada"],
      ["/second", 200, "second", "second answered bea"],
      // A route not found skips global middleware.
      ["/second", 404, null, null],
      ["/first", 404, null, null],
    ]);
  });
});
