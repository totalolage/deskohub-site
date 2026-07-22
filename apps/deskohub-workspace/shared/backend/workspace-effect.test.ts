import { describe, expect, mock, test } from "bun:test";
import type { EffectBoundaryExecutor } from "@deskohub/next-effect";
import {
  Cause,
  Context,
  Data,
  Effect,
  Exit,
  Layer,
  Logger,
  References,
  Schema,
} from "effect";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { makeWorkspaceEffect } from "./effect-boundary/next";
import { WorkspaceRouteFailure } from "./effect-boundary/route-failure";

mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

type CapturedLog = {
  readonly annotations: Readonly<Record<string, unknown>>;
  readonly message: unknown;
};

class ActionTestService extends Context.Service<
  ActionTestService,
  { readonly verify: () => Effect.Effect<void> }
>()("WorkspaceEffectActionTestService") {}

const makeHarness = (requestHeaders = new Headers()) => {
  const logs: CapturedLog[] = [];
  let actionHeaderReads = 0;
  let actionServiceCalls = 0;
  let scheduledFlushes = 0;
  let taskFlushes = 0;
  const captureLogger = Logger.make((options) => {
    logs.push({
      annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      message: options.message,
    });
  });
  const runExit: EffectBoundaryExecutor["runExit"] = (effect, options) =>
    Effect.runPromiseExit(
      effect.pipe(Effect.provide(Logger.layer([captureLogger]))),
      options
    );
  const executor: EffectBoundaryExecutor = {
    runExit,
    runTask: async (effect) => {
      const exit = await runExit(effect);
      taskFlushes += 1;
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    },
  };
  const workspace = makeWorkspaceEffect({
    executor,
    actionLayer: Layer.succeed(ActionTestService, {
      verify: () =>
        Effect.sync(() => {
          actionServiceCalls += 1;
        }),
    }),
    readActionHeaders: () =>
      Effect.sync(() => {
        actionHeaderReads += 1;
        return requestHeaders;
      }),
    scheduleTelemetryFlush: () =>
      Effect.sync(() => {
        scheduledFlushes += 1;
      }),
  });

  return {
    get actionHeaderReads() {
      return actionHeaderReads;
    },
    get actionServiceCalls() {
      return actionServiceCalls;
    },
    get scheduledFlushes() {
      return scheduledFlushes;
    },
    get taskFlushes() {
      return taskFlushes;
    },
    logs,
    workspace,
  };
};

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("WorkspaceEffectTestService") {}

class TestLayerError extends Data.TaggedError("TestLayerError")<{
  readonly message: string;
}> {}

describe("WorkspaceEffect", () => {
  test("route adds safe request metadata and schedules one flush", async () => {
    const consent = encodeURIComponent(
      JSON.stringify({ categories: ["necessary", "analytics"] })
    );
    const harness = makeHarness();
    const request = new Request("https://deskohub.test/api/test", {
      method: "POST",
      headers: {
        cookie: `cc_cookie=${consent}; ${POSTHOG_DISTINCT_ID_COOKIE}=distinct; ${POSTHOG_SESSION_ID_COOKIE}=session`,
      },
    });
    const POST = harness.workspace.route(
      {
        operation: "test.route",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.logInfo("handled").pipe(Effect.as(new Response("ok")))
    );

    await expect((await POST(request)).text()).resolves.toBe("ok");
    expect(harness.scheduledFlushes).toBe(1);
    expect(harness.logs[0]?.annotations).toMatchObject({
      boundary: "route",
      operation: "test.route",
      method: "POST",
      posthogDistinctId: "distinct",
      sessionId: "session",
    });
    expect(harness.logs[0]?.annotations).not.toHaveProperty("cookie");
  });

  test("route maps handler and Layer failures to censored public JSON", async () => {
    const harness = makeHarness();
    const GET = harness.workspace.route(
      {
        operation: "test.layer-failure",
        cancellation: "continue-after-disconnect",
        layer: Layer.effect(
          TestService,
          Effect.fail(new TestLayerError({ message: "private setup" }))
        ),
        mapFailure: (cause) =>
          new WorkspaceRouteFailure({
            statusCode: 503,
            publicMessage: "Temporarily unavailable",
            cause,
          }),
      },
      () => Effect.map(TestService, () => new Response("unused"))
    );

    const response = await GET(new Request("https://deskohub.test/api/test"));
    const publicBody = await response.clone().json();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Temporarily unavailable",
    });
    expect(JSON.stringify(publicBody)).not.toContain("private setup");
  });

  test("route recognizes structurally tagged Workspace failures", async () => {
    const harness = makeHarness();
    const failure: WorkspaceRouteFailure = {
      _tag: "WorkspaceRouteFailure",
      statusCode: 418,
      publicMessage: "Tagged failure",
    };
    const GET = harness.workspace.route(
      {
        operation: "test.tagged-route-failure",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.fail(failure).pipe(Effect.as(new Response("unused")))
    );

    const response = await GET(new Request("https://deskohub.test/api/test"));
    expect(response.status).toBe(418);
    await expect(response.json()).resolves.toEqual({ error: "Tagged failure" });
  });

  test("route failure logging preserves the cause for censorship", async () => {
    const harness = makeHarness();
    const cause = new TestLayerError({ message: "private cause" });
    const GET = harness.workspace.route(
      {
        operation: "test.route-failure-cause",
        cancellation: "continue-after-disconnect",
      },
      () =>
        Effect.fail(
          new WorkspaceRouteFailure({
            statusCode: 500,
            publicMessage: "Public failure",
            cause,
          })
        ).pipe(Effect.as(new Response("unused")))
    );

    await GET(new Request("https://deskohub.test/api/test"));
    const failureLog = harness.logs.find(
      ({ message }) =>
        Array.isArray(message) &&
        message[0] === "Workspace route request failed"
    );
    expect(failureLog?.message).toEqual([
      "Workspace route request failed",
      { statusCode: 500, cause },
    ]);
  });

  test("route suspends synchronous handler construction as a defect", async () => {
    const harness = makeHarness();
    const defect = new Error("construction defect");
    const GET = harness.workspace.route(
      {
        operation: "test.route-defect",
        cancellation: "continue-after-disconnect",
      },
      () => {
        throw defect;
      }
    );

    await expect(
      GET(new Request("https://deskohub.test/api/test"))
    ).rejects.toBe(defect);
    expect(harness.scheduledFlushes).toBe(1);
  });

  test("route cancellation is selected explicitly", async () => {
    const harness = makeHarness();
    const controller = new AbortController();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const interrupted = harness.workspace.route(
      {
        operation: "test.interrupt",
        cancellation: "interrupt-on-disconnect",
      },
      () => Effect.sync(markStarted).pipe(Effect.andThen(Effect.never))
    );
    const request = new Request("https://deskohub.test/api/test", {
      signal: controller.signal,
    });
    const result = interrupted(request);
    await started;
    controller.abort();

    await expect(result).rejects.toBeDefined();

    const continued = harness.workspace.route(
      {
        operation: "test.continue",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.succeed(new Response("continued"))
    );
    await expect((await continued(request)).text()).resolves.toBe("continued");
  });

  test("action starts the lifecycle only after validation", async () => {
    const harness = makeHarness();
    const action = harness.workspace.action(
      {
        operation: "test.action",
        schema: Schema.toStandardSchemaV1(Schema.FiniteFromString),
      },
      ({ parsedInput }) =>
        parsedInput === 13
          ? Effect.fail(
              new PublicSafeActionError({ message: "Public failure" })
            )
          : Effect.succeed(parsedInput * 2)
    );

    await expect(action("invalid")).resolves.toMatchObject({
      validationErrors: expect.any(Object),
    });
    expect(harness.actionHeaderReads).toBe(0);
    expect(harness.scheduledFlushes).toBe(0);

    await expect(action("21")).resolves.toEqual({ data: 42 });
    await expect(action("13")).resolves.toEqual({
      serverError: "Public failure",
    });
    expect(harness.actionHeaderReads).toBe(2);
    expect(harness.scheduledFlushes).toBe(2);
  });

  test("action provides its shared Workspace capability Layer", async () => {
    const harness = makeHarness();
    const action = harness.workspace.action(
      {
        operation: "test.protected-action",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () => Effect.flatMap(ActionTestService, (service) => service.verify())
    );

    await expect(action("input")).resolves.toEqual({ data: undefined });
    expect(harness.actionServiceCalls).toBe(1);
  });

  test("stateful form actions use the same validated lifecycle", async () => {
    const harness = makeHarness();
    const action = harness.workspace.action(
      {
        operation: "test.stateful-action",
        schema: Schema.toStandardSchemaV1(Schema.FiniteFromString),
        stateful: true,
      },
      ({ parsedInput }, { prevResult }) =>
        Effect.succeed({
          previous: prevResult.data,
          value: parsedInput * 2,
        })
    );

    await expect(action({ data: { value: 1 } }, "21")).resolves.toEqual({
      data: { previous: { value: 1 }, value: 42 },
    });
    expect(harness.actionHeaderReads).toBe(1);
    expect(harness.scheduledFlushes).toBe(1);
  });

  test("task awaits its composition flush and preserves rejection", async () => {
    const harness = makeHarness();
    const succeeds = harness.workspace.task({ operation: "test.task" }, () =>
      Effect.succeed("done")
    );
    const failure = new Error("retry");
    const fails = harness.workspace.task(
      { operation: "test.task-failure" },
      () => Effect.fail(failure)
    );

    await expect(succeeds()).resolves.toBe("done");
    await expect(fails()).rejects.toBe(failure);
    expect(harness.taskFlushes).toBe(2);
  });
});
