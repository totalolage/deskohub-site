import { expect, mock, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { failWorkspaceTelemetry } from "@/shared/testing/workspace-telemetry.test-utils";
import { markPrivateResponse } from "@/shared/utils/private-response";

const runtimeBuildFailure = new Error(
  "synthetic PostHog logging configuration unusable"
);

// The shared runtime builds its observability layer before entering any
// Effect, so every route in this file fails before its handler runs.
failWorkspaceTelemetry(runtimeBuildFailure);

const { defineWorkspaceRoute } = await import("./workspace-route");

test("a route with a fallback answers a runtime that cannot be built with it", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  const handler = mock(() => Effect.succeed(new Response("handled")));
  try {
    const route = defineWorkspaceRoute(
      {
        operation: "test.route-runtime-failure",
        cancellation: "interrupt-on-disconnect",
        caller: "client",
        fallback: {
          failureCode: "test.route_runtime_failure",
          response: () =>
            markPrivateResponse(
              Response.json({ error: "Unavailable." }, { status: 500 })
            ),
        },
      },
      handler
    );

    const response = await route(new Request("https://deskohub.test"));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(handler).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("a route without a fallback still rejects when the runtime cannot be built", async () => {
  const handler = mock(() => Effect.succeed(new Response("handled")));
  const route = defineWorkspaceRoute(
    {
      operation: "test.route-runtime-failure",
      cancellation: "interrupt-on-disconnect",
      caller: "client",
    },
    handler
  );

  await expect(route(new Request("https://deskohub.test"))).rejects.toBe(
    runtimeBuildFailure
  );
  expect(handler).not.toHaveBeenCalled();
});
