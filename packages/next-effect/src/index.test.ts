import { describe, expect, test } from "bun:test";
import { Context, Effect, Exit, Layer } from "effect";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { NextEffect, type NextEffectRouteRunner } from ".";

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("@deskohub/next-effect/test/RunnerService") {}

describe("NextEffect", () => {
  test("run provides the configured layer", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });

    await expect(
      next.run(
        Effect.gen(function* () {
          const service = yield* TestService;
          return service.value;
        })
      )
    ).resolves.toBe("service");
  });

  test("run maps fallible layer setup failures", async () => {
    const mapped = new Error("mapped");
    const next = NextEffect.make({
      layer: Layer.effect(TestService, Effect.fail("setup")),
      mapError: () => mapped,
    });

    await expect(next.run(TestService)).rejects.toBe(mapped);
  });

  test("page passes props into an Effect component", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });
    const Page = next.page((props: { readonly slug: string }) =>
      Effect.gen(function* () {
        const service = yield* TestService;
        return `${service.value}:${props.slug}`;
      })
    );

    await expect(Page({ slug: "menu" })).resolves.toBe("service:menu");
  });

  test("page preserves Next control-flow throws", async () => {
    const next = NextEffect.make();
    const Page = next.page(() => Effect.sync(() => redirect("/target")));

    await expect(Page({})).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  test("route runs request-only handlers with the default executor", async () => {
    const next = NextEffect.make();
    const request = new Request("https://deskohub.test/api/example", {
      method: "POST",
    });
    const POST = next.route((receivedRequest) =>
      Effect.succeed(
        new Response(receivedRequest.method, {
          status: 201,
        })
      )
    );

    const response = await POST(request);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(201);
    await expect(response.text()).resolves.toBe("POST");
  });

  test("route provides the configured layer", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });
    const GET = next.route(() =>
      Effect.gen(function* () {
        const service = yield* TestService;
        return new Response(service.value);
      })
    );

    const response = await GET(new Request("https://deskohub.test/example"));

    await expect(response.text()).resolves.toBe("service");
  });

  test("route forwards additional Next route context", async () => {
    const next = NextEffect.make();
    const context = { params: Promise.resolve({ slug: "menu" }) };
    const GET = next.route(
      (
        request: Request,
        receivedContext: { readonly params: Promise<{ slug: string }> }
      ) =>
        Effect.promise(async () => {
          const { slug } = await receivedContext.params;
          return new Response(`${request.method}:${slug}`);
        })
    );

    const response = await GET(
      new Request("https://deskohub.test/example"),
      context
    );

    await expect(response.text()).resolves.toBe("GET:menu");
  });

  test("route preserves NextResponse results", async () => {
    const next = NextEffect.make();
    const GET = next.route(() =>
      Effect.succeed(NextResponse.json({ ok: true }))
    );

    const response = await GET(new Request("https://deskohub.test/example"));

    expect(response).toBeInstanceOf(NextResponse);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("route honors request cancellation with the default executor", async () => {
    const next = NextEffect.make();
    const controller = new AbortController();
    let interruptObserved = false;
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const GET = next.route(() =>
      Effect.sync(markStarted).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interruptObserved = true;
          })
        )
      )
    );
    const response = GET(
      new Request("https://deskohub.test/example", {
        signal: controller.signal,
      })
    );

    await started;
    controller.abort();

    await expect(response).rejects.toBeDefined();
    expect(interruptObserved).toBe(true);
  });

  test("route passes the provided Effect to a custom request runner", async () => {
    const requests: Request[] = [];
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "provided" }),
      runRoute: async (request, effect) => {
        requests.push(request);
        return Effect.runPromise(effect);
      },
    });
    const GET = next.route(() =>
      Effect.gen(function* () {
        const service = yield* TestService;
        return new Response(service.value);
      })
    );
    const request = new Request("https://deskohub.test/example");

    const response = await GET(request);

    expect(requests).toEqual([request]);
    await expect(response.text()).resolves.toBe("provided");
  });

  test("custom route runners own request cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const next = NextEffect.make({
      runRoute: (_request, effect) => Effect.runPromise(effect),
    });
    const GET = next.route(() => Effect.succeed(new Response("completed")));

    const response = await GET(
      new Request("https://deskohub.test/example", {
        signal: controller.signal,
      })
    );

    await expect(response.text()).resolves.toBe("completed");
  });

  test("custom route runners can recover with a typed response", async () => {
    const next = NextEffect.make({
      runRoute: (_request, effect) =>
        Effect.runPromise(
          Effect.catch(effect, () =>
            Effect.succeed(new Response("recovered", { status: 500 }))
          )
        ),
    });
    const GET = next.route(() => Effect.fail("route failure"));

    const response = await GET(new Request("https://deskohub.test/example"));

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("recovered");
  });

  test("route maps handler failures", async () => {
    const mapped = new Error("mapped handler");
    const next = NextEffect.make({ mapError: () => mapped });
    const GET = next.route(() => Effect.fail("handler"));

    await expect(
      GET(new Request("https://deskohub.test/example"))
    ).rejects.toBe(mapped);
  });

  test("route maps fallible layer setup failures", async () => {
    const mapped = new Error("mapped setup");
    const next = NextEffect.make({
      layer: Layer.effect(TestService, Effect.fail("setup")),
      mapError: () => mapped,
    });
    const GET = next.route(() =>
      Effect.map(TestService, () => new Response("unused"))
    );

    await expect(
      GET(new Request("https://deskohub.test/example"))
    ).rejects.toBe(mapped);
  });

  test("route preserves Next control-flow throws with the default executor", async () => {
    const next = NextEffect.make();
    const GET = next.route(() =>
      Effect.sync(() => {
        redirect("/target");
        return new Response();
      })
    );

    await expect(
      GET(new Request("https://deskohub.test/example"))
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  test("custom route runners do not change run or page execution", async () => {
    let routeCalls = 0;
    const next = NextEffect.make({
      runRoute: async (_request, effect) => {
        routeCalls += 1;
        return Effect.runPromise(effect);
      },
    });
    const Page = next.page((props: { readonly slug: string }) =>
      Effect.succeed(props.slug)
    );

    await expect(next.run(Effect.succeed("run"))).resolves.toBe("run");
    await expect(Page({ slug: "page" })).resolves.toBe("page");
    expect(routeCalls).toBe(0);
  });

  test("an injected Exit runner is used once and preserves Next control flow", async () => {
    let calls = 0;
    const next = NextEffect.make({
      runExit: async <A, E>(
        effect: Effect.Effect<A, E, never>,
        options?: { readonly signal?: AbortSignal }
      ) => {
        calls += 1;
        return Effect.runPromiseExit(effect, options);
      },
    });
    const Page = next.page(() => Effect.sync(() => notFound()));

    await expect(Page({})).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(calls).toBe(1);
  });

  test("explicit route options select whether request cancellation applies", async () => {
    const next = NextEffect.make();
    const controller = new AbortController();
    const request = new Request("https://deskohub.test/example", {
      signal: controller.signal,
    });
    const continueRoute = next.route({}, () =>
      Effect.succeed(new Response("continued"))
    );
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const interruptRoute = next.route(
      { signal: (receivedRequest) => receivedRequest.signal },
      () => Effect.sync(markStarted).pipe(Effect.andThen(Effect.never))
    );

    await expect((await continueRoute(request)).text()).resolves.toBe(
      "continued"
    );
    const interrupted = interruptRoute(request);
    await started;
    controller.abort();
    await expect(interrupted).rejects.toBeDefined();
  });

  test("page and route methods remain extractable", async () => {
    const { page, route } = NextEffect.make({
      runExit: <A, E>(effect: Effect.Effect<A, E, never>) =>
        Effect.runPromiseExit(effect),
    });
    const Page = page(() => Effect.succeed("page"));
    const GET = route({}, () => Effect.succeed(new Response("route")));

    await expect(Page({})).resolves.toBe("page");
    await expect(
      (await GET(new Request("https://deskohub.test/example"))).text()
    ).resolves.toBe("route");
  });

  test("rejects conflicting executor models in development", () => {
    expect(() =>
      NextEffect.make({
        runExit: (() => Promise.resolve(Exit.succeed(undefined))) as never,
        runRoute: (() => Promise.resolve(new Response())) as never,
      } as never)
    ).toThrow("cannot combine runExit");
  });
});

if (process.env.NEXT_EFFECT_ROUTE_TYPECHECK === "1") {
  const next = NextEffect.make();

  next.route((request: Request) => Effect.succeed(new Response(request.url)));
  next.route(
    (
      _request: Request,
      context: { readonly params: Promise<{ readonly slug: string }> }
    ) =>
      Effect.map(
        Effect.promise(() => context.params),
        () => new Response()
      )
  );

  // @ts-expect-error Route handlers must return a Response or subtype.
  next.route(() => Effect.succeed("not a response"));

  // @ts-expect-error runExit and legacy route runners are mutually exclusive.
  NextEffect.make({
    runExit: <A, E>(effect: Effect.Effect<A, E, never>) =>
      Effect.runPromiseExit(effect),
    runRoute: (_request, effect) => Effect.runPromise(effect),
  });

  class SuccessfulRouteResponse extends Response {
    readonly outcome = "success" as const;
  }

  class FailedRouteResponse extends Response {
    readonly outcome = "failure" as const;
  }

  const runRecoveringRoute: NextEffectRouteRunner<FailedRouteResponse> = (
    _request,
    effect
  ) =>
    Effect.runPromise(
      Effect.catch(effect, () => Effect.succeed(new FailedRouteResponse()))
    );
  const recoveringNext = NextEffect.make({
    layer: Layer.succeed(TestService, { value: "service" }),
    runRoute: runRecoveringRoute,
  });
  const recoveredRoute = recoveringNext.route(() =>
    Effect.map(TestService, () => new SuccessfulRouteResponse())
  );
  const RecoveryPage = recoveringNext.page(() => Effect.succeed("page"));

  void recoveredRoute(new Request("https://deskohub.test/example")).then(
    (response) => {
      const routeResponse: SuccessfulRouteResponse | FailedRouteResponse =
        response;

      // @ts-expect-error Recovery keeps the failure response in the result type.
      const successOnly: SuccessfulRouteResponse = response;

      return routeResponse.outcome + successOnly.outcome;
    }
  );
  void recoveringNext.run(Effect.succeed("run")).then((result) => {
    const exactRunResult: string = result;

    // @ts-expect-error Route recovery does not widen run results.
    const routeError: FailedRouteResponse = result;

    return exactRunResult + routeError.outcome;
  });
  void RecoveryPage({}).then((result) => {
    const exactPageResult: string = result;

    // @ts-expect-error Route recovery does not widen page results.
    const routeError: FailedRouteResponse = result;

    return exactPageResult + routeError.outcome;
  });
}
