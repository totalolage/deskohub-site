import { describe, expect, test } from "bun:test";
import { Context, Data, Effect, Layer } from "effect";
import {
  defineWorkspaceRoute,
  mapWorkspaceInternalRouteFailure,
  WorkspaceRouteFailure,
} from "./workspace-route";

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("WorkspaceRouteTestService") {}

class TestLayerError extends Data.TaggedError("TestLayerError")<{
  readonly message: string;
}> {}

describe("Workspace routes", () => {
  test("preserves route arguments and successful responses", async () => {
    const GET = defineWorkspaceRoute(
      {
        operation: "test.route",
        cancellation: "continue-after-disconnect",
      },
      (_request, context: { readonly value: string }) =>
        Effect.succeed(new Response(context.value))
    );

    const response = await GET(new Request("https://deskohub.test"), {
      value: "ready",
    });

    await expect(response.text()).resolves.toBe("ready");
  });

  test("recovers typed failures without exposing their cause", async () => {
    const cause = new TestLayerError({ message: "private setup" });
    const GET = defineWorkspaceRoute(
      {
        operation: "test.failure",
        cancellation: "continue-after-disconnect",
      },
      () =>
        Effect.fail(
          new WorkspaceRouteFailure({
            statusCode: 503,
            publicMessage: "Temporarily unavailable",
            cause,
          })
        ).pipe(Effect.as(new Response("unused")))
    );

    const response = await GET(new Request("https://deskohub.test"));
    const body = await response.clone().text();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Temporarily unavailable",
    });
    expect(body).not.toContain("private setup");
  });

  test("maps Layer acquisition failures in the declared Effect", async () => {
    const GET = defineWorkspaceRoute(
      {
        operation: "test.layer-failure",
        cancellation: "continue-after-disconnect",
      },
      () =>
        TestService.pipe(
          Effect.map(({ value }) => new Response(value)),
          Effect.provide(
            Layer.effect(
              TestService,
              Effect.fail(new TestLayerError({ message: "private setup" }))
            )
          ),
          Effect.mapError(
            mapWorkspaceInternalRouteFailure("Temporarily unavailable")
          )
        )
    );

    const response = await GET(new Request("https://deskohub.test"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Temporarily unavailable",
    });
  });

  test("suspends synchronous handler construction as a defect", async () => {
    const defect = new Error("construction defect");
    const GET = defineWorkspaceRoute(
      {
        operation: "test.defect",
        cancellation: "continue-after-disconnect",
      },
      () => {
        throw defect;
      }
    );

    await expect(GET(new Request("https://deskohub.test"))).rejects.toBe(
      defect
    );
  });

  test("uses the request signal only when interruption is declared", async () => {
    const controller = new AbortController();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const interrupted = defineWorkspaceRoute(
      {
        operation: "test.interrupt",
        cancellation: "interrupt-on-disconnect",
      },
      () => Effect.sync(markStarted).pipe(Effect.andThen(Effect.never))
    );
    const request = new Request("https://deskohub.test", {
      signal: controller.signal,
    });
    const result = interrupted(request);
    await started;
    controller.abort();

    await expect(result).rejects.toBeDefined();

    const continued = defineWorkspaceRoute(
      {
        operation: "test.continue",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.succeed(new Response("continued"))
    );
    await expect((await continued(request)).text()).resolves.toBe("continued");
  });
});
