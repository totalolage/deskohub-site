import { expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

let observabilityBuilds = 0;
const CountedTracingLive = Layer.effectDiscard(
  Effect.sync(() => {
    observabilityBuilds += 1;
  })
);

// Counts builds of the observability Layer the runtime and web handlers share.
mock.module("@/instrumentation", () => ({ postHogLoggerProvider: undefined }));
mock.module("./observability/workspace-tracing", () => ({
  createWorkspaceTracingLive: () => CountedTracingLive,
  WorkspaceTracingLive: CountedTracingLive,
}));

const { runWorkspaceEffect, toWorkspaceWebHandler } = await import(
  "./workspace-effect"
);

const serving = (path: `/${string}`) =>
  toWorkspaceWebHandler(
    HttpRouter.add("GET", path, Effect.succeed(HttpServerResponse.empty()))
  );

test("web handlers and runs share one observability build when a handler builds it first", async () => {
  const first = serving("/first");
  const response = await first(
    new Request("https://workspace.deskohub.test/first")
  );
  expect(response.status).toBe(204);
  expect(observabilityBuilds).toBe(1);

  await Effect.void.pipe(runWorkspaceEffect("test.after-handler"));
  const second = serving("/second");
  const later = await second(
    new Request("https://workspace.deskohub.test/second")
  );
  expect(later.status).toBe(204);
  expect(observabilityBuilds).toBe(1);
});
