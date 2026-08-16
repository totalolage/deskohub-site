import { describe, expect, test } from "bun:test";
import {
  createPostHogTracerProvider,
  getPostHogTracesEndpoint,
} from "./posthog-tracing";

describe("PostHog OTel traces", () => {
  test("builds the PostHog OTLP traces endpoint", () => {
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

  test("requires the ingest host when tracing is enabled", () => {
    expect(() =>
      createPostHogTracerProvider({
        deploymentEnvironment: "preview",
        posthogProjectToken: "phc_test",
      })
    ).toThrow("POSTHOG_INGEST_HOST is required");
  });

  test("creates a flushable tracer provider with a project token", async () => {
    const provider = createPostHogTracerProvider({
      deploymentEnvironment: "preview",
      posthogHost: "https://ingest.posthog.example",
      posthogProjectToken: "phc_test",
    });

    expect(provider?.forceFlush).toEqual(expect.any(Function));
    await provider?.shutdown();
  });
});
