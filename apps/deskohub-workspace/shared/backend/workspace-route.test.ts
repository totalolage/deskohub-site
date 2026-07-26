import { describe, expect, spyOn, test } from "bun:test";
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
        operation: "workspaceAvailability",
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
    const sentinel = "SYNTHETIC-SENSITIVE-SENTINEL";
    const cause = new AggregateError(
      [
        sentinel,
        new TestLayerError({ message: sentinel }),
        { customerId: sentinel, cause: new Error(sentinel) },
      ],
      sentinel
    );
    const errorLog = spyOn(console, "error").mockImplementation(
      () => undefined
    );
    const GET = defineWorkspaceRoute(
      {
        operation: "workspaceAvailability",
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

    try {
      const response = await GET(new Request("https://deskohub.test"));
      const body = await response.clone().text();
      const emitted = JSON.stringify(errorLog.mock.calls);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "Temporarily unavailable",
      });
      expect(body).not.toContain(sentinel);
      expect(emitted).not.toContain(sentinel);
      expect(emitted).not.toContain("customerId");
    } finally {
      errorLog.mockRestore();
    }
  });

  test("maps Layer acquisition failures in the declared Effect", async () => {
    const GET = defineWorkspaceRoute(
      {
        operation: "workspaceAvailability",
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

  test("normalizes synchronous and asynchronous framework defects", async () => {
    const sentinel = "SYNTHETIC-FRAMEWORK-DEFECT";
    const GET = defineWorkspaceRoute(
      {
        operation: "workspaceAvailability",
        cancellation: "continue-after-disconnect",
      },
      () => {
        throw new Error(sentinel);
      }
    );
    const POST = defineWorkspaceRoute(
      {
        operation: "workspaceAvailability",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.promise(() => Promise.reject(new Error(sentinel)))
    );

    for (const response of [
      await GET(new Request("https://deskohub.test")),
      await POST(
        new Request("https://deskohub.test", {
          method: "POST",
        })
      ),
    ]) {
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Request failed.",
      });
    }
  });

  test("uses the request signal only when interruption is declared", async () => {
    const controller = new AbortController();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const interrupted = defineWorkspaceRoute(
      {
        operation: "workspaceAvailability",
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
        operation: "workspaceAvailability",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.succeed(new Response("continued"))
    );
    await expect((await continued(request)).text()).resolves.toBe("continued");
  });
});
