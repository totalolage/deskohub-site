import { expect, test } from "bun:test";
import { type TracerProvider, trace } from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

// Each build of the observability Layer the runtime and web handlers share
// takes one tracer from the global tracer provider, which `registerOTel`
// installs in production.
let observabilityBuilds = 0;
const tracerProvider = new BasicTracerProvider();
trace.setGlobalTracerProvider({
  getTracer: (...args: Parameters<TracerProvider["getTracer"]>) => {
    observabilityBuilds += 1;
    return tracerProvider.getTracer(...args);
  },
});

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
