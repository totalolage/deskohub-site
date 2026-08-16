import { describe, expect, spyOn, test } from "bun:test";
import type { LoggerProvider } from "@opentelemetry/api-logs";
import {
  createPostHogLoggerProvider,
  flushPostHogLogs,
  getPostHogLogsEndpoint,
} from "./posthog-otel";

describe("PostHog OTel logs", () => {
  test("builds the PostHog OTLP logs endpoint", () => {
    expect(getPostHogLogsEndpoint("https://eu.i.posthog.com")).toBe(
      "https://eu.i.posthog.com/i/v1/logs"
    );
  });

  test("does not create a logger provider without a project token", () => {
    expect(createPostHogLoggerProvider({})).toBeUndefined();
  });

  test("requires VERCEL_ENV when logging is enabled", () => {
    expect(() =>
      createPostHogLoggerProvider({
        posthogHost: "https://ingest.posthog.example",
        posthogProjectToken: "phc_test",
      })
    ).toThrow("VERCEL_ENV is required");
  });

  test("requires the ingest host when logging is enabled", () => {
    expect(() =>
      createPostHogLoggerProvider({
        posthogProjectToken: "phc_test",
        vercelEnv: "development",
      })
    ).toThrow("POSTHOG_INGEST_HOST is required");
  });

  test("creates a flushable logger provider with a project token", async () => {
    const provider = createPostHogLoggerProvider({
      posthogHost: "https://ingest.posthog.example",
      posthogProjectToken: "phc_test",
      vercelEnv: "development",
    });

    expect(provider?.forceFlush).toEqual(expect.any(Function));
    await provider?.shutdown();
  });

  test("bounds a flush when the logger provider does not settle", async () => {
    const provider = {
      forceFlush: () => new Promise<void>(() => undefined),
    } as Pick<LoggerProvider, "forceFlush">;
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await Promise.race([
      flushPostHogLogs({ provider, timeoutMs: 5 }).then(
        () => "completed" as const
      ),
      new Promise<"still-pending">((resolve) =>
        setTimeout(() => resolve("still-pending"), 100)
      ),
    ]);

    expect(result).toBe("completed");
    expect(warn).toHaveBeenCalledWith(
      "PostHog log flush exceeded its post-response deadline."
    );
    warn.mockRestore();
  });
});
