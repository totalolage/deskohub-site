import { describe, expect, test } from "bun:test";
import {
  createPostHogTracerProvider,
  getPostHogTracesEndpoint,
} from "./posthog-tracing";

describe("PostHog OTel traces", () => {
  test("builds the PostHog OTLP traces endpoint", () => {
    expect(getPostHogTracesEndpoint()).toBe(
      "https://us.i.posthog.com/i/v1/traces"
    );
    expect(getPostHogTracesEndpoint("https://eu.i.posthog.com")).toBe(
      "https://eu.i.posthog.com/i/v1/traces"
    );
  });

  test("does not create a tracer provider without a project token", () => {
    expect(
      createPostHogTracerProvider({
        deploymentEnvironment: "preview",
      })
    ).toBeUndefined();
  });

  test("creates a flushable tracer provider with a project token", async () => {
    const provider = createPostHogTracerProvider({
      deploymentEnvironment: "preview",
      posthogProjectToken: "phc_test",
    });

    expect(typeof provider?.forceFlush).toBe("function");
    await provider?.shutdown();
  });
});
