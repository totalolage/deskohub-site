<<<<<<< HEAD
import { describe, expect, mock, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { LoggerProvider } from "@opentelemetry/api-logs";
import { Effect, Logger } from "effect";
import { createCensoredOtelLogger } from "./censorship";
=======
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
>>>>>>> 71b705cb2396074a4a58813c2ab71fc15f9514df
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

<<<<<<< HEAD
  test("censors nested causes through the production OTLP log sink", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        requests.push(await request.text());
        return new Response(null, { status: 200 });
      },
    });
    const provider = createPostHogLoggerProvider({
      posthogHost: server.url.toString(),
      posthogProjectToken: randomBytes(24).toString("base64url"),
      vercelEnv: "development",
    });
    if (!provider) throw new Error("Expected a synthetic logger provider.");

    try {
      const sentinel = "SENSITIVE-CATEGORY-SENTINEL";
      const nestedCause = new AggregateError(
        [
          sentinel,
          42,
          false,
          {
            _tag: "SyntheticTaggedCause",
            cause: new Error(sentinel, {
              cause: { providerOrderId: sentinel },
            }),
            customerId: sentinel,
          },
        ],
        sentinel
      );

      await Effect.runPromise(
        Effect.logError("code-owned log message", {
          cause: nestedCause,
          checkoutSessionId: sentinel,
        }).pipe(
          Effect.provide(Logger.layer([createCensoredOtelLogger(provider)]))
        )
      );
      await provider.forceFlush();

      const exported = requests.join("");
      expect(exported).toContain("fieldCount");
      expect(exported).not.toContain(sentinel);
    } finally {
      await provider.shutdown();
      server.stop(true);
    }
  });

  test("censors direct global-style OTLP log records at the provider boundary", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        requests.push(await request.text());
        return new Response(null, { status: 200 });
      },
    });
    const provider = createPostHogLoggerProvider({
      posthogHost: server.url.toString(),
      posthogProjectToken: randomBytes(24).toString("base64url"),
      vercelEnv: "development",
    });
    if (!provider) throw new Error("Expected a synthetic logger provider.");

    try {
      provider
        .getLogger("framework", "SyntheticValidScopeVersion", {
          schemaUrl: "https://SyntheticValidScopeSchema.test",
        })
        .emit({
          body: "SyntheticValidDirectLogBody",
          eventName: "SyntheticValidDirectEvent",
          attributes: {
            SyntheticValidDynamicKey: "SyntheticValidDynamicValue",
            category: "SyntheticValidCategory",
            detail: "SyntheticValidDetail",
            response: JSON.stringify({
              payload: "SyntheticValidNestedPayload",
            }),
          },
        });
      await provider.forceFlush();

      expect(requests).toHaveLength(1);
      expect(requests[0]).not.toContain("SyntheticValid");
    } finally {
      await provider.shutdown();
      server.stop(true);
    }
  });

  test("bounds a scheduled flush when the logger provider does not settle", async () => {
    let scheduledTask: (() => Promise<void>) | undefined;
    const schedule = mock((task: () => Promise<void>) => {
      scheduledTask = task;
    });
=======
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
>>>>>>> 71b705cb2396074a4a58813c2ab71fc15f9514df
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
