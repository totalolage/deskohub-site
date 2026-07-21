import { describe, expect, mock, spyOn, test } from "bun:test";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import {
  createPostHogLoggerProvider,
  getPostHogLogsEndpoint,
  schedulePostHogLogsFlush,
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

  test("bounds a scheduled flush when the logger provider does not settle", async () => {
    let scheduledTask: (() => Promise<void>) | undefined;
    const schedule = mock((task: () => Promise<void>) => {
      scheduledTask = task;
    });
    const provider = {
      forceFlush: () => new Promise<void>(() => undefined),
    } as Pick<LoggerProvider, "forceFlush">;
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);

    schedulePostHogLogsFlush(schedule, { provider, timeoutMs: 5 });

    expect(schedule).toHaveBeenCalledTimes(1);
    const task = scheduledTask;
    expect(task).toBeDefined();
    if (!task) throw new Error("Expected a scheduled PostHog flush task");

    const result = await Promise.race([
      task().then(() => "completed" as const),
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
