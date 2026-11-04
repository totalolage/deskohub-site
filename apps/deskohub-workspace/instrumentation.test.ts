import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { LoggerProvider } from "@opentelemetry/api-logs";
import type { registerOTel as registerVercelOTel } from "@vercel/otel";

// Nothing here reaches a real OpenTelemetry or PostHog endpoint: the OTel
// registration, the global logger provider and the Workspace telemetry are
// fakes.
const registerOTel = mock(
  (_options: Parameters<typeof registerVercelOTel>[0]) => undefined
);
const vercelOtel = await import("@vercel/otel");
mock.module("@vercel/otel", () => ({ ...vercelOtel, registerOTel }));

const setGlobalLoggerProvider = mock((_provider: LoggerProvider) => true);
const apiLogs = await import("@opentelemetry/api-logs");
mock.module("@opentelemetry/api-logs", () => ({
  ...apiLogs,
  logs: { setGlobalLoggerProvider },
}));

const syntheticRegistration = { serviceName: "synthetic-workspace" };
const syntheticLoggerProvider = { synthetic: "workspace logger provider" };
let loggerProviderEnabled = false;
const workspaceOTelRegistration = mock(() => syntheticRegistration);
const workspaceLoggerProvider = mock(() =>
  loggerProviderEnabled ? syntheticLoggerProvider : undefined
);
const workspaceTelemetry = await import(
  "./shared/backend/observability/workspace-telemetry"
);
mock.module("./shared/backend/observability/workspace-telemetry", () => ({
  ...workspaceTelemetry,
  workspaceLoggerProvider,
  workspaceOTelRegistration,
}));

const { register } = await import("./instrumentation");

const originalRuntime = process.env.NEXT_RUNTIME;

beforeEach(() => {
  registerOTel.mockClear();
  setGlobalLoggerProvider.mockClear();
  workspaceLoggerProvider.mockClear();
});

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
});

describe("register", () => {
  test("wires nothing outside the Node.js runtime", async () => {
    loggerProviderEnabled = true;
    process.env.NEXT_RUNTIME = "edge";

    await register();

    expect(registerOTel).not.toHaveBeenCalled();
    expect(workspaceLoggerProvider).not.toHaveBeenCalled();
    expect(setGlobalLoggerProvider).not.toHaveBeenCalled();
  });

  test("registers the Workspace tracing", async () => {
    loggerProviderEnabled = false;
    process.env.NEXT_RUNTIME = "nodejs";

    await register();

    expect(registerOTel).toHaveBeenCalledTimes(1);
    expect(registerOTel).toHaveBeenCalledWith(syntheticRegistration as never);
  });

  test("keeps the global logger provider without a Workspace logger provider", async () => {
    loggerProviderEnabled = false;
    process.env.NEXT_RUNTIME = "nodejs";

    await register();

    expect(setGlobalLoggerProvider).not.toHaveBeenCalled();
  });

  test("sends logs through the Workspace logger provider when there is one", async () => {
    loggerProviderEnabled = true;
    process.env.NEXT_RUNTIME = "nodejs";

    await register();

    expect(setGlobalLoggerProvider).toHaveBeenCalledTimes(1);
    expect(setGlobalLoggerProvider).toHaveBeenCalledWith(
      syntheticLoggerProvider as never
    );
  });
});
