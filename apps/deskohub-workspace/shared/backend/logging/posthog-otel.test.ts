import { describe, expect, test } from "bun:test";
import {
  createPostHogLoggerProvider,
  getPostHogLogsEndpoint,
} from "./posthog-otel";

describe("PostHog OTel logs", () => {
  test("builds the PostHog OTLP logs endpoint", () => {
    expect(getPostHogLogsEndpoint()).toBe("https://us.i.posthog.com/i/v1/logs");
    expect(getPostHogLogsEndpoint("https://eu.i.posthog.com")).toBe(
      "https://eu.i.posthog.com/i/v1/logs"
    );
  });

  test("does not create a logger provider without a project token", () => {
    expect(createPostHogLoggerProvider({})).toBeUndefined();
  });

  test("requires VERCEL_ENV when logging is enabled", () => {
    expect(() =>
      createPostHogLoggerProvider({ posthogProjectToken: "phc_test" })
    ).toThrow("VERCEL_ENV is required");
  });

  test("creates a flushable logger provider with a project token", async () => {
    const provider = createPostHogLoggerProvider({
      posthogProjectToken: "phc_test",
      vercelEnv: "development",
    });

    expect(typeof provider?.forceFlush).toBe("function");
    await provider?.shutdown();
  });
});
