import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CloudinarySignatureRedactor } from "@deskohub/cloudinary/telemetry";
import type { LoggerProvider } from "@opentelemetry/api-logs";
import type { registerOTel as registerVercelOTel } from "@vercel/otel";
import { env } from "./env";
import type { createPostHogLoggerProvider as createRealPostHogLoggerProvider } from "./shared/backend/logging/posthog-otel";
import {
  WORKSPACE_SERVICE_NAME,
  WORKSPACE_SERVICE_NAMESPACE,
} from "./shared/backend/observability/workspace-service";

// Nothing here reaches a real OpenTelemetry or PostHog endpoint: the OTel
// registration, the global logger provider and the PostHog provider are fakes.
const registerOTel = mock(
  (_options: Parameters<typeof registerVercelOTel>[0]) => undefined
);
mock.module("@vercel/otel", () => ({ registerOTel }));

const setGlobalLoggerProvider = mock((_provider: LoggerProvider) => true);
mock.module("@opentelemetry/api-logs", () => ({
  logs: { setGlobalLoggerProvider },
}));

const syntheticLoggerProvider = { synthetic: "posthog logger provider" };
let postHogLoggingEnabled = false;
const createPostHogLoggerProvider = mock(
  (_options: Parameters<typeof createRealPostHogLoggerProvider>[0]) =>
    postHogLoggingEnabled ? syntheticLoggerProvider : undefined
);
mock.module("@/shared/backend/logging/posthog-otel", () => ({
  createPostHogLoggerProvider,
}));

const originalRuntime = process.env.NEXT_RUNTIME;

beforeEach(() => {
  registerOTel.mockClear();
  setGlobalLoggerProvider.mockClear();
  createPostHogLoggerProvider.mockClear();
});

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
});

describe("postHogLoggerProvider", () => {
  test("is built from the server's PostHog and Vercel settings", async () => {
    await import("./instrumentation?settings");

    expect(createPostHogLoggerProvider).toHaveBeenCalledWith({
      posthogHost: env.POSTHOG_INGEST_HOST,
      posthogProjectToken: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      vercelEnv: env.VERCEL_ENV,
      vercelGitCommitSha: env.VERCEL_GIT_COMMIT_SHA,
    });
  });
});

describe("register", () => {
  test("wires nothing outside the Node.js runtime", async () => {
    postHogLoggingEnabled = true;
    const { register } = await import("./instrumentation?edge");
    process.env.NEXT_RUNTIME = "edge";

    await register();

    expect(registerOTel).not.toHaveBeenCalled();
    expect(setGlobalLoggerProvider).not.toHaveBeenCalled();
  });

  test("registers tracing with the span redactors ahead of the exporters", async () => {
    postHogLoggingEnabled = false;
    const { register } = await import("./instrumentation?tracing");
    process.env.NEXT_RUNTIME = "nodejs";

    await register();

    expect(registerOTel).toHaveBeenCalledTimes(1);
    expect(registerOTel).toHaveBeenCalledWith({
      serviceName: WORKSPACE_SERVICE_NAME,
      attributes: { "service.namespace": WORKSPACE_SERVICE_NAMESPACE },
      spanProcessors: [expect.any(CloudinarySignatureRedactor), "auto"],
    });
  });

  test("keeps the global logger provider without PostHog logging", async () => {
    postHogLoggingEnabled = false;
    const { register } = await import("./instrumentation?without-posthog");
    process.env.NEXT_RUNTIME = "nodejs";

    await register();

    expect(registerOTel).toHaveBeenCalledTimes(1);
    expect(setGlobalLoggerProvider).not.toHaveBeenCalled();
  });

  test("sends logs to PostHog when PostHog logging is enabled", async () => {
    postHogLoggingEnabled = true;
    const { register, postHogLoggerProvider } = await import(
      "./instrumentation?with-posthog"
    );
    process.env.NEXT_RUNTIME = "nodejs";

    await register();

    expect(postHogLoggerProvider).toBe(syntheticLoggerProvider as never);
    expect(setGlobalLoggerProvider).toHaveBeenCalledTimes(1);
    expect(setGlobalLoggerProvider).toHaveBeenCalledWith(
      syntheticLoggerProvider
    );
  });
});
