import { describe, expect, test } from "bun:test";
import { Context, Data, Effect, Layer } from "effect";
import { EffectBoundary } from "./effect-boundary";
import { NextEffect } from "./index";

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("@deskohub/next-effect/test/BoundaryService") {}

class TestRouteFailure extends Data.TaggedError("TestRouteFailure")<{
  readonly status: number;
}> {}

const makeBoundary = () => {
  let actionInvocations = 0;
  let routeInvocations = 0;
  const executor = EffectBoundary.makeExecutor();
  const boundary = NextEffect.makeBoundary<TestRouteFailure, Response>({
    executor,
    route: {
      isFailure: (failure): failure is TestRouteFailure =>
        failure instanceof TestRouteFailure,
      recoverFailure: (failure) =>
        Effect.succeed(new Response("recovered", { status: failure.status })),
      withRequest: (_request, effect) =>
        Effect.sync(() => {
          routeInvocations += 1;
        }).pipe(Effect.andThen(effect)),
    },
    action: {
      withInvocation: (effect) =>
        Effect.sync(() => {
          actionInvocations += 1;
        }).pipe(Effect.andThen(effect)),
    },
  });

  return {
    boundary,
    get actionInvocations() {
      return actionInvocations;
    },
    get routeInvocations() {
      return routeInvocations;
    },
  };
};

describe("NextEffect boundary declarations", () => {
  test("provides declaration Layers and maps their failures through route policy", async () => {
    const harness = makeBoundary();
    const GET = harness.boundary.route(
      {
        operation: "test.route-layer",
        cancellation: "continue-after-disconnect",
        layer: Layer.effect(TestService, Effect.fail("setup")),
        mapFailure: () => new TestRouteFailure({ status: 503 }),
      },
      () => Effect.map(TestService, ({ value }) => new Response(value))
    );

    const response = await GET(new Request("https://example.test"));

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("recovered");
    expect(harness.routeInvocations).toBe(1);
  });

  test("preserves route context and suspends handler construction", async () => {
    const harness = makeBoundary();
    const defect = new Error("construction failed");
    const GET = harness.boundary.route(
      {
        operation: "test.route-context",
        cancellation: "continue-after-disconnect",
      },
      (_request, context: { readonly value: string }) => {
        if (context.value === "fail") throw defect;
        return Effect.succeed(new Response(context.value));
      }
    );

    await expect(
      (
        await GET(new Request("https://example.test"), { value: "ready" })
      ).text()
    ).resolves.toBe("ready");
    await expect(
      GET(new Request("https://example.test"), { value: "fail" })
    ).rejects.toBe(defect);
    expect(harness.routeInvocations).toBe(2);
  });

  test("selects disconnect cancellation explicitly", async () => {
    const harness = makeBoundary();
    const controller = new AbortController();
    const request = new Request("https://example.test", {
      signal: controller.signal,
    });
    const interrupted = harness.boundary.route(
      {
        operation: "test.interrupt",
        cancellation: "interrupt-on-disconnect",
      },
      () => Effect.never
    );

    const result = interrupted(request);
    controller.abort();

    await expect(result).rejects.toBeDefined();

    const continued = harness.boundary.route(
      {
        operation: "test.continue",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.succeed(new Response("continued"))
    );
    await expect((await continued(request)).text()).resolves.toBe("continued");
  });

  test("wraps native action invocation while preserving variadic inference", async () => {
    const harness = makeBoundary();
    const action = harness.boundary.action(
      { operation: "test.action" },
      (left: number, right: number) => Effect.succeed(left + right)
    );

    await expect(action(20, 22)).resolves.toBe(42);
    expect(harness.actionInvocations).toBe(1);
  });

  test("keeps every declaration method extractable", async () => {
    const { page, route, action, task, run } = makeBoundary().boundary;
    const Page = page({ operation: "test.page" }, () => Effect.succeed("page"));
    const GET = route(
      {
        operation: "test.route",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.succeed(new Response("route"))
    );
    const invoke = action({ operation: "test.action" }, () =>
      Effect.succeed("action")
    );
    const invokeTask = task({ operation: "test.task" }, () =>
      Effect.succeed("task")
    );

    await expect(Page({})).resolves.toBe("page");
    await expect(
      (await GET(new Request("https://example.test"))).text()
    ).resolves.toBe("route");
    await expect(invoke()).resolves.toBe("action");
    await expect(invokeTask()).resolves.toBe("task");
    await expect(
      run({ operation: "test.run" }, Effect.succeed("run"))
    ).resolves.toBe("run");
  });
});
