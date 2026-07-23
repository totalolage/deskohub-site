import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import {
  createPostHogLoggerProvider,
  flushPostHogLogs,
  getPostHogLogsEndpoint,
  getRegisteredPostHogLoggerProvider,
  registerPostHogLoggerProvider,
} from "./posthog-otel";

afterEach(() => {
  registerPostHogLoggerProvider(undefined);
});

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

  test("registers the provider used by implicit flushes", async () => {
    const forceFlush = mock(() => Promise.resolve());
    const provider = {
      forceFlush,
    } as unknown as Parameters<typeof registerPostHogLoggerProvider>[0];

    registerPostHogLoggerProvider(provider);

    expect(getRegisteredPostHogLoggerProvider()).toBe(provider);
    await flushPostHogLogs();
    expect(forceFlush).toHaveBeenCalledTimes(1);
  });

  test("does nothing when a flush has no provider", async () => {
    await expect(flushPostHogLogs()).resolves.toBeUndefined();
  });

  test("contains provider flush failures", async () => {
    const provider = {
      forceFlush: () => Promise.reject(new Error("flush failed")),
    } as Pick<LoggerProvider, "forceFlush">;
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(flushPostHogLogs({ provider })).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith("PostHog log flush failed.");
    } finally {
      warn.mockRestore();
    }
  });

  test("bounds a flush when the logger provider does not settle", async () => {
    const provider = {
      forceFlush: () => new Promise<void>(() => undefined),
    } as Pick<LoggerProvider, "forceFlush">;
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
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
    } finally {
      warn.mockRestore();
    }
  });
});
