import { describe, expect, spyOn, test } from "bun:test";
import { Context, Data, Effect, Layer } from "effect";
import { notFound, redirect } from "next/navigation";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
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

  test("normalizes invalid public status codes to an internal error", async () => {
    const GET = defineWorkspaceRoute(
      {
        operation: "test.invalid-status",
        cancellation: "continue-after-disconnect",
      },
      () =>
        Effect.fail(
          new WorkspaceRouteFailure({
            statusCode: 200,
            publicMessage: "Request failed",
          })
        ).pipe(Effect.as(new Response("unused")))
    );

    const response = await GET(new Request("https://deskohub.test"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Request failed",
    });
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

  test("annotates logs with the request method and consented request context", async () => {
    const analyticsConsent = `cc_cookie=${encodeURIComponent(
      JSON.stringify({ categories: ["necessary", "analytics"] })
    )}`;
    const info = spyOn(console, "info").mockImplementation(() => undefined);
    const POST = defineWorkspaceRoute(
      {
        operation: "test.annotations",
        cancellation: "continue-after-disconnect",
      },
      () =>
        Effect.logInfo("route annotations").pipe(
          Effect.as(new Response("ready"))
        )
    );

    try {
      await POST(
        new Request("https://deskohub.test", {
          method: "post",
          headers: {
            cookie: `${analyticsConsent}; ${POSTHOG_DISTINCT_ID_COOKIE}=distinct-id; ${POSTHOG_SESSION_ID_COOKIE}=session-id`,
          },
        })
      );

      const output = info.mock.calls.flat().join(" ");
      expect(output).toContain("boundary=route");
      expect(output).toContain("operation=test.annotations");
      expect(output).toContain("method=POST");
      expect(output).toContain("posthogDistinctId=distinct-id");
      expect(output).toContain("sessionId=session-id");
    } finally {
      info.mockRestore();
    }
  });

  test("runs handler finalizers when a typed failure is recovered", async () => {
    let finalizations = 0;
    const GET = defineWorkspaceRoute(
      {
        operation: "test.finalizer",
        cancellation: "continue-after-disconnect",
      },
      () =>
        Effect.fail(
          new WorkspaceRouteFailure({
            statusCode: 503,
            publicMessage: "Unavailable",
          })
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              finalizations += 1;
            })
          ),
          Effect.as(new Response("unused"))
        )
    );

    const response = await GET(new Request("https://deskohub.test"));

    expect(response.status).toBe(503);
    expect(finalizations).toBe(1);
  });

  test("uses the request signal only when interruption is declared", async () => {
    const controller = new AbortController();
    let finalizations = 0;
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const interrupted = defineWorkspaceRoute(
      {
        operation: "workspaceAvailability",
        cancellation: "interrupt-on-disconnect",
      },
      () =>
        Effect.sync(markStarted).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              finalizations += 1;
            })
          )
        )
    );
    const request = new Request("https://deskohub.test", {
      signal: controller.signal,
    });
    const result = interrupted(request);
    await started;
    controller.abort();

    await expect(result).rejects.toBeDefined();
    expect(finalizations).toBe(1);

    const continued = defineWorkspaceRoute(
      {
        operation: "workspaceAvailability",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.succeed(new Response("continued"))
    );
    await expect((await continued(request)).text()).resolves.toBe("continued");
  });

  test("preserves redirect and not-found control flow", async () => {
    const redirectRoute = defineWorkspaceRoute(
      {
        operation: "test.redirect",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.sync((): Response => redirect("/target"))
    );
    const notFoundRoute = defineWorkspaceRoute(
      {
        operation: "test.not-found",
        cancellation: "continue-after-disconnect",
      },
      () => Effect.sync((): Response => notFound())
    );

    await expect(
      redirectRoute(new Request("https://deskohub.test"))
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    await expect(
      notFoundRoute(new Request("https://deskohub.test"))
    ).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });
});
