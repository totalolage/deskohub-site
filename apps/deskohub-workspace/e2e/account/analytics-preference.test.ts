import { describe, expect, test } from "bun:test";
import type { Page, Request, Response } from "@playwright/test";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import type { E2EBrowserSession } from "../browser-session";
import { toWorkspaceE2EError, WorkspaceE2EError } from "../errors";
import { withinWorkspaceE2EDeadline } from "../polling";
import { workspaceE2ETimeouts } from "../timeouts";
import { reloadDeviceUntilMirrored } from "./analytics-preference";

const origin = "https://workspace.test";
const operation = "sign in analytics preference device";

const never = new Promise<never>(() => undefined);

const fakeRequest = (
  init: {
    readonly body?: string;
    readonly headers?: Record<string, string>;
    readonly method?: string;
  },
  response: () => Promise<Response | null> = () => never
) =>
  Object.assign({} as Request, {
    headers: () => init.headers ?? {},
    method: () => init.method ?? "GET",
    postData: () => init.body ?? null,
    response,
  });

const fakeResponse = (
  request: Request,
  init: {
    readonly headers?: Record<string, string>;
    readonly path: string;
    readonly status: number;
  }
) =>
  Object.assign({} as Response, {
    headers: () => init.headers ?? {},
    request: () => request,
    status: () => init.status,
    url: () => new URL(init.path, origin).toString(),
  });

/** The mirror's hydration request, whose response `respond` resolves. */
const hydrationRequest = (
  respond: () => Promise<Response | null> = () => never
) =>
  fakeRequest(
    {
      body: '[{"occasion":"hydration"}]',
      headers: { "next-action": "mirror" },
      method: "POST",
    },
    respond
  );

const hydrationResponse = () => {
  const request = hydrationRequest();
  return fakeResponse(request, { path: "/en-US/account/legal", status: 200 });
};

const rateLimitedSessionRead = (retryAfterSeconds?: string) =>
  fakeResponse(fakeRequest({}), {
    headers:
      retryAfterSeconds === undefined
        ? {}
        : { "x-retry-after": retryAfterSeconds },
    path: "/api/auth/get-session",
    status: 429,
  });

/** What one reload sends before the response that settles its wait. */
type ReloadScript = {
  readonly requests: readonly Request[];
  readonly settles: Response;
};

/**
 * A page whose reloads follow `scripts` in order: each reload emits its
 * requests to the `request` listeners, then settles the pending
 * `waitForResponse` with its response when the predicate accepts it.
 */
const scriptedPage = (
  scripts: readonly ReloadScript[],
  reloadedAt: (index: number) => void
) => {
  const listeners = new Set<(request: Request) => void>();
  let waiter:
    | {
        readonly accept: (response: Response) => boolean;
        readonly resolve: (response: Response) => void;
      }
    | undefined;
  let reloads = 0;
  return Object.assign({} as Page, {
    off: (_event: "request", listener: (request: Request) => void) => {
      listeners.delete(listener);
    },
    on: (_event: "request", listener: (request: Request) => void) => {
      listeners.add(listener);
    },
    reload: async () => {
      const script = scripts[reloads];
      reloadedAt(reloads);
      reloads += 1;
      if (script === undefined) throw new Error("unscripted reload");
      for (const request of script.requests)
        for (const listener of listeners) listener(request);
      if (waiter?.accept(script.settles)) waiter.resolve(script.settles);
      return null;
    },
    waitForResponse: (accept: (response: Response) => boolean) =>
      new Promise<Response>((resolve) => {
        waiter = { accept, resolve };
      }),
  });
};

/**
 * A browser session driving `page` as `E2EBrowserSession.use` does: a
 * rejected callback becomes the operation's failure, and a deadline bounds
 * the whole callback.
 */
const sessionOver = (page: Page) =>
  Object.assign({} as E2EBrowserSession, {
    use: <A>(
      label: string,
      drive: (page: Page) => Promise<A>,
      deadline: { readonly timeoutMs?: number } = {}
    ) => {
      const attempt = Effect.tryPromise({
        catch: (cause) => toWorkspaceE2EError(label, cause),
        try: () => drive(page),
      });
      return deadline.timeoutMs === undefined
        ? attempt
        : withinWorkspaceE2EDeadline(attempt, label, deadline.timeoutMs);
    },
  });

/** Lets the fake page's promise callbacks run before time moves on. */
const settlePromises = Effect.promise(
  () => new Promise<void>((resolve) => setImmediate(resolve))
);

/**
 * Runs the reload against `scripts` under the TestClock, advancing time one
 * second at a time up to `untilMs` and calling `onTick` with each new time,
 * and returns its exit, or `undefined` when it is still running, with the
 * TestClock time of every reload.
 */
const runReload = (
  scripts: readonly ReloadScript[],
  untilMs: number,
  onTick: (nowMs: number) => void = () => undefined
) =>
  Effect.gen(function* () {
    const reloadTimes: number[] = [];
    const clock = yield* TestClock.testClockWith(Effect.succeed);
    const page = scriptedPage(scripts, () =>
      reloadTimes.push(clock.currentTimeMillisUnsafe())
    );
    const fiber = yield* Effect.forkChild(
      reloadDeviceUntilMirrored(sessionOver(page))
    );
    yield* settlePromises;
    while (clock.currentTimeMillisUnsafe() < untilMs) {
      yield* TestClock.adjust("1 second");
      onTick(clock.currentTimeMillisUnsafe());
      yield* settlePromises;
    }
    const exit = fiber.pollUnsafe();
    yield* Fiber.interrupt(fiber);
    return { exit, reloadTimes };
  }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

const failureOf = (exit: Exit.Exit<void, WorkspaceE2EError> | undefined) => {
  if (exit === undefined || !Exit.isFailure(exit))
    throw new Error("expected the reload to have failed");
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("expected a typed failure");
  expect(failure.value).toBeInstanceOf(WorkspaceE2EError);
  return failure.value;
};

const deadlineMs = workspaceE2ETimeouts.browserNavigation;

describe("analytics preference device sign-in reload", () => {
  test("fails with its own timeout when the mirror request sent beside a rate-limited session read never answers", async () => {
    const { exit: beforeDeadline } = await runReload(
      [
        {
          requests: [hydrationRequest()],
          settles: rateLimitedSessionRead("1"),
        },
      ],
      deadlineMs - 1000
    );
    expect(beforeDeadline).toBeUndefined();

    const { exit, reloadTimes } = await runReload(
      [
        {
          requests: [hydrationRequest()],
          settles: rateLimitedSessionRead("1"),
        },
      ],
      deadlineMs + 5000
    );
    const failure = failureOf(exit);
    expect(failure.reason).toBe("timeout");
    expect(failure.operation).toBe(operation);
    expect(reloadTimes).toEqual([0]);
  });

  test("succeeds without another reload when the pending mirror request answers after a rate-limited session read", async () => {
    let answer: (response: Response) => void = () => undefined;
    const answered = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const scripts = [
      {
        requests: [hydrationRequest(() => answered)],
        settles: rateLimitedSessionRead("1"),
      },
    ];

    const { exit, reloadTimes } = await runReload(scripts, 5000, (nowMs) => {
      if (nowMs === 2000) answer(hydrationResponse());
    });
    expect(exit !== undefined && Exit.isSuccess(exit)).toBe(true);
    expect(reloadTimes).toEqual([0]);
  });

  test("succeeds on the first reload when the mirror's hydration response settles it", async () => {
    const response = hydrationResponse();
    const { exit, reloadTimes } = await runReload(
      [{ requests: [response.request()], settles: response }],
      1000
    );
    expect(exit !== undefined && Exit.isSuccess(exit)).toBe(true);
    expect(reloadTimes).toEqual([0]);
  });

  test("reloads again after the delay a rate-limited session read asks for", async () => {
    const response = hydrationResponse();
    const { exit, reloadTimes } = await runReload(
      [
        { requests: [], settles: rateLimitedSessionRead("3") },
        { requests: [response.request()], settles: response },
      ],
      5000
    );
    expect(exit !== undefined && Exit.isSuccess(exit)).toBe(true);
    expect(reloadTimes).toEqual([0, 3000]);
  });

  test("stops after two more reloads when the session read stays rate limited", async () => {
    const { exit, reloadTimes } = await runReload(
      [
        { requests: [], settles: rateLimitedSessionRead("3") },
        { requests: [], settles: rateLimitedSessionRead() },
        { requests: [], settles: rateLimitedSessionRead("1") },
      ],
      30_000
    );
    const failure = failureOf(exit);
    expect(failure.reason).toBeUndefined();
    expect(failure.cause).toBeUndefined();
    expect(failure.operation).toBe(operation);
    // Better Auth's 10-second window stands in for the missing header.
    expect(reloadTimes).toEqual([0, 3000, 13_000]);
  });
});
