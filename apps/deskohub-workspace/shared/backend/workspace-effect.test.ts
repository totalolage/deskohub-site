import { describe, expect, mock, spyOn, test } from "bun:test";
import { Cause, Context, Deferred, Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { redirect } from "next/navigation";
import * as nextServer from "next/server";
import { captureWorkspaceLogs } from "@/shared/testing/workspace-telemetry.test-utils";
import { CENSORED_LOG_VALUE } from "@/shared/utils/log-classification";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import * as serverAnalyticsDelivery from "./analytics/analytics-event-delivery.service";
import { shareAcrossRequests } from "./share-across-requests";

const workspaceLogs = captureWorkspaceLogs();
const logFlushes = spyOn(workspaceLogs.loggerProvider, "forceFlush");

// A consented visitor in Next's request store, which work that serves no
// visitor must never pick up.
const ambientHeaders = mock(async () => {
  const consent = encodeURIComponent(
    JSON.stringify({ categories: ["necessary", "analytics"] })
  );
  return new Headers({
    cookie: `cc_cookie=${consent}; ${POSTHOG_DISTINCT_ID_COOKIE}=ambient-visitor; ${POSTHOG_SESSION_ID_COOKIE}=ambient-session`,
  });
});
mock.module("next/headers", () => ({ headers: ambientHeaders }));

// Callbacks Next.js would run after the response. Outside a request scope,
// Next's `after` throws instead.
const afterResponse: (() => unknown)[] = [];
let insideRequestScope = true;
mock.module("next/server", () => ({
  ...nextServer,
  after: (callback: () => unknown) => {
    if (!insideRequestScope) {
      throw new Error("`after` was called outside a request scope.");
    }
    afterResponse.push(callback);
  },
}));

/** Runs the callbacks queued after the response, including nested ones. */
const sendResponse = async () => {
  while (afterResponse.length > 0) {
    await Promise.all(afterResponse.splice(0).map((callback) => callback()));
  }
};

// Each flush of the process's server analytics capture client.
const serverAnalyticsFlushes = mock(() => undefined);
mock.module("./analytics/analytics-event-delivery.service", () => ({
  ...serverAnalyticsDelivery,
  flushServerAnalytics: Effect.sync(serverAnalyticsFlushes),
  isServerAnalyticsEnabled: true,
}));

const {
  catchRecoverableCause,
  defineWorkspaceTask,
  findNextControlFlow,
  runWorkspaceEffect,
  runWorkspaceEffectAfterResponse,
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

  test("emits logs to the process's log sink, censored and annotated", async () => {
    workspaceLogs.reset();

    await Effect.logInfo("exported", { token: "private" }).pipe(
      runWorkspaceEffect("test.posthog-export", { boundary: "page" })
    );

    const records = workspaceLogs.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toMatchObject({
      boundary: "page",
      operation: "test.posthog-export",
    });
    expect(JSON.stringify(records[0]?.body)).toContain(CENSORED_LOG_VALUE);
    expect(JSON.stringify(records[0]?.body)).not.toContain("private");
  });

  test("tasks serve no customer request, so their agent traffic is unclassified", async () => {
    const { CurrentAgentTraffic } = await import("./workspace-request-context");
    const task = defineWorkspaceTask("test.task-agent-traffic", () =>
      Effect.map(CurrentAgentTraffic, (traffic) => traffic)
    );

    await expect(task()).resolves.toEqual({ category: "unclassified" });
  });

  test("tasks serve no visitor, even with one in Next's request store", async () => {
    const { currentVisitorIdentity } = await import(
      "./workspace-request-context"
    );
    ambientHeaders.mockClear();
    const task = defineWorkspaceTask(
      "test.task-visitor",
      () => currentVisitorIdentity
    );

    await expect(task()).resolves.toEqual({});
    expect(ambientHeaders).not.toHaveBeenCalled();
  });

  test("work after the response serves no visitor, even with one in Next's request store", async () => {
    const { currentVisitorIdentity } = await import(
      "./workspace-request-context"
    );
    ambientHeaders.mockClear();
    afterResponse.length = 0;
    const seen: unknown[] = [];

    await Effect.runPromise(
      runWorkspaceEffectAfterResponse(
        "test.after-response-visitor",
        Effect.tap(currentVisitorIdentity, (visitor) =>
          Effect.sync(() => seen.push(visitor))
        )
      )
    );
    expect(afterResponse).toHaveLength(1);
    await afterResponse[0]?.();

    expect(seen).toEqual([{}]);
    expect(ambientHeaders).not.toHaveBeenCalled();
  });

  test("tasks send their logs and the server analytics they queued before they settle", async () => {
    serverAnalyticsFlushes.mockClear();
    logFlushes.mockClear();
    afterResponse.length = 0;
    const task = defineWorkspaceTask("test.task-telemetry-flush", () =>
      Effect.sync(() => serverAnalyticsFlushes.mock.calls.length)
    );

    await expect(task()).resolves.toBe(0);
    expect(serverAnalyticsFlushes).toHaveBeenCalledTimes(1);
    expect(logFlushes).toHaveBeenCalledTimes(1);
    expect(afterResponse).toHaveLength(0);
  });

  for (const boundary of ["page", "route", "action", "run"] as const) {
    test(`a ${boundary} run flushes its telemetry after the response, not before`, async () => {
      serverAnalyticsFlushes.mockClear();
      logFlushes.mockClear();
      afterResponse.length = 0;

      await Effect.void.pipe(
        runWorkspaceEffect(`test.${boundary}-flush`, { boundary })
      );
      expect(serverAnalyticsFlushes).not.toHaveBeenCalled();
      expect(logFlushes).not.toHaveBeenCalled();
      expect(afterResponse).toHaveLength(1);
      await sendResponse();

      expect(serverAnalyticsFlushes).toHaveBeenCalledTimes(1);
      expect(logFlushes).toHaveBeenCalledTimes(1);
    });
  }

  test("a run that outlives the response flushes once it settles", async () => {
    logFlushes.mockClear();
    afterResponse.length = 0;
    const gate = Deferred.makeUnsafe<void>();

    const run = Deferred.await(gate).pipe(
      Effect.andThen(Effect.logInfo("revalidated")),
      runWorkspaceEffect("test.outliving-flush", { boundary: "page" })
    );
    const responseSent = sendResponse();
    await Bun.sleep(0);
    expect(logFlushes).not.toHaveBeenCalled();

    Effect.runSync(Deferred.succeed(gate, undefined));
    await run;
    await responseSent;

    expect(logFlushes).toHaveBeenCalledTimes(1);
  });

  test("a failing run still flushes its telemetry after the response", async () => {
    logFlushes.mockClear();
    afterResponse.length = 0;

    await expect(
      Effect.fail(new Error("synthetic failure")).pipe(
        runWorkspaceEffect("test.failed-flush", { boundary: "route" })
      )
    ).rejects.toThrow("synthetic failure");
    await sendResponse();

    expect(logFlushes).toHaveBeenCalledTimes(1);
  });

  test("work after the response sends its telemetry before it settles", async () => {
    serverAnalyticsFlushes.mockClear();
    logFlushes.mockClear();
    afterResponse.length = 0;
    const flushesDuringWork: number[] = [];

    await Effect.runPromise(
      runWorkspaceEffectAfterResponse(
        "test.after-response-flush",
        Effect.sync(() => flushesDuringWork.push(logFlushes.mock.calls.length))
      )
    );
    expect(afterResponse).toHaveLength(1);
    await afterResponse.splice(0)[0]?.();

    expect(flushesDuringWork).toEqual([0]);
    expect(logFlushes).toHaveBeenCalledTimes(1);
    expect(serverAnalyticsFlushes).toHaveBeenCalledTimes(1);
    // No flush is left to run beside a later callback.
    expect(afterResponse).toHaveLength(0);
  });

  test("outside a request scope, a run starts its flush when it ends and keeps the function alive for it", async () => {
    logFlushes.mockClear();
    afterResponse.length = 0;
    const registered: Promise<unknown>[] = [];
    const vercelRequestContext = Symbol.for("@vercel/request-context");
    const previousContext = Reflect.get(globalThis, vercelRequestContext);
    Reflect.set(globalThis, vercelRequestContext, {
      get: () => ({
        waitUntil: (promise: Promise<unknown>) => registered.push(promise),
      }),
    });
    insideRequestScope = false;

    try {
      const flushesDuringRun: number[] = [];
      await Effect.sync(() =>
        flushesDuringRun.push(logFlushes.mock.calls.length)
      ).pipe(runWorkspaceEffect("test.unscoped-flush"));
      await Promise.all(registered);

      expect(flushesDuringRun).toEqual([0]);
      expect(afterResponse).toHaveLength(0);
      expect(logFlushes).toHaveBeenCalledTimes(1);
      // The run's own settlement and its flush.
      expect(registered).toHaveLength(2);
    } finally {
      insideRequestScope = true;
      Reflect.set(globalThis, vercelRequestContext, previousContext);
    }
  });

  test("a flush that rejects never fails the response it follows", async () => {
    logFlushes.mockClear();
    logFlushes.mockImplementationOnce(() =>
      Promise.reject(new Error("export failed"))
    );
    afterResponse.length = 0;
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(
        Effect.succeed("value").pipe(
          runWorkspaceEffect("test.rejected-flush", { boundary: "route" })
        )
      ).resolves.toBe("value");
      await sendResponse();

      expect(logFlushes).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.flat().join(" ")).toContain(
        "PostHog log flush failed."
      );
    } finally {
      warn.mockRestore();
    }
  });

  test("a run without a boundary reads the visitor from Next's request store", async () => {
    const { currentVisitorIdentity } = await import(
      "./workspace-request-context"
    );
    ambientHeaders.mockClear();

    await expect(
      currentVisitorIdentity.pipe(runWorkspaceEffect("test.page-visitor"))
    ).resolves.toEqual({
      distinctId: "ambient-visitor",
      sessionId: "ambient-session",
    });
    expect(ambientHeaders).toHaveBeenCalledTimes(1);
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

  test("flushes each request's telemetry after its response", async () => {
    logFlushes.mockClear();
    serverAnalyticsFlushes.mockClear();
    afterResponse.length = 0;
    const handler = toWorkspaceWebHandler(
      HttpRouter.add(
        "GET",
        "/flushed",
        Effect.succeed(HttpServerResponse.text("served"))
      )
    );

    const response = await handler(request("/flushed", "ada"));
    expect(await response.text()).toBe("served");
    expect(logFlushes).not.toHaveBeenCalled();
    expect(afterResponse).toHaveLength(1);
    await sendResponse();

    expect(logFlushes).toHaveBeenCalledTimes(1);
    expect(serverAnalyticsFlushes).toHaveBeenCalledTimes(1);
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

  test("serves a route Layer several handlers share from each of them", async () => {
    const answering = HttpRouter.add(
      "GET",
      "/shared",
      Effect.map(RequestCaller, (caller) =>
        HttpServerResponse.text(`answered ${caller.name}`)
      )
    ).pipe(Layer.provide(CallerFromRequest));
    const first = toWorkspaceWebHandler(answering);
    const second = toWorkspaceWebHandler(answering);

    // The first handler builds the shared route Layer before the second.
    const firstAnswer = await first(request("/shared", "ada"));
    const requests = [
      [second, "bea"],
      [first, "cyd"],
      [second, "dov"],
    ] as const;
    const answers = await Promise.all(
      requests.map(async ([handle, caller]) => {
        const response = await handle(request("/shared", caller));
        return [response.status, await response.text()];
      })
    );

    expect([firstAnswer.status, await firstAnswer.text()]).toEqual([
      200,
      "answered ada",
    ]);
    expect(answers).toEqual([
      [200, "answered bea"],
      [200, "answered cyd"],
      [200, "answered dov"],
    ]);
  });

  test("builds a Layer two handlers use once per handler, and a shared Layer once for handlers and runs", async () => {
    let ownBuilds = 0;
    let sharedBuilds = 0;
    class Own extends Context.Service<Own, { readonly id: number }>()(
      "test/Own"
    ) {
      static Live = Layer.sync(this, () => {
        ownBuilds += 1;
        return { id: ownBuilds };
      });
    }
    class Shared extends Context.Service<Shared, { readonly id: number }>()(
      "test/Shared"
    ) {
      static Live = shareAcrossRequests(
        Layer.sync(this, () => {
          sharedBuilds += 1;
          return { id: sharedBuilds };
        })
      );
    }
    const serving = HttpRouter.add(
      "GET",
      "/instances",
      Effect.gen(function* () {
        const own = yield* Own;
        const shared = yield* Shared;
        return HttpServerResponse.jsonUnsafe({
          own: own.id,
          shared: shared.id,
        });
      })
    ).pipe(HttpRouter.provideRequest(Layer.merge(Own.Live, Shared.Live)));
    const first = toWorkspaceWebHandler(serving);
    const second = toWorkspaceWebHandler(serving);
    const served = async (handle: typeof first, caller: string) =>
      (await handle(request("/instances", caller))).json();

    expect(await served(first, "ada")).toEqual({ own: 1, shared: 1 });
    expect(await served(second, "bea")).toEqual({ own: 2, shared: 1 });
    expect(await served(first, "cyd")).toEqual({ own: 1, shared: 1 });
    expect(
      await Effect.map(Shared, ({ id }) => id).pipe(
        Effect.provide(Shared.Live),
        runWorkspaceEffect("test.shared-instance")
      )
    ).toBe(1);
    expect([ownBuilds, sharedBuilds]).toEqual([2, 1]);
  });

  test("keeps a failed build for its handler without failing another handler's build", async () => {
    let builds = 0;
    const Unavailable = Layer.effectDiscard(
      Effect.suspend(() => {
        builds += 1;
        return Effect.fail(new Error(`build ${builds} failed`));
      })
    );
    const serving = Layer.merge(
      HttpRouter.add("GET", "/unavailable", HttpServerResponse.empty()),
      Unavailable
    );
    const first = toWorkspaceWebHandler(serving);
    const second = toWorkspaceWebHandler(serving);

    await expect(first(request("/unavailable", "ada"))).rejects.toThrow(
      "build 1 failed"
    );
    await expect(first(request("/unavailable", "bea"))).rejects.toThrow(
      "build 1 failed"
    );
    expect(builds).toBe(1);
    await expect(second(request("/unavailable", "cyd"))).rejects.toThrow(
      "build 2 failed"
    );
    expect(builds).toBe(2);
  });
});
