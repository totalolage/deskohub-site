import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { context, createTraceState, trace } from "@opentelemetry/api";
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

  test("projects the actual PostHog OTLP trace payload closed", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        requests.push(await request.text());
        return new Response(null, { status: 200 });
      },
    });
    const provider = createPostHogTracerProvider({
      deploymentEnvironment: "preview",
      posthogHost: server.url.toString(),
      posthogProjectToken: randomBytes(24).toString("base64url"),
      serviceName: "SyntheticValidServiceName",
      serviceNamespace: "SyntheticValidNamespace",
      serviceVersion: "SyntheticValidVersion",
    });
    if (!provider) throw new Error("Expected a synthetic tracer provider.");

    try {
      const traceState = createTraceState("synthetic=SyntheticValidTraceState");
      const span = provider
        .getTracer("SyntheticValidScopeName", "SyntheticValidScopeVersion", {
          schemaUrl: "https://SyntheticValidScopeSchema.test",
        })
        .startSpan(
          "SyntheticValidSpanName",
          {
            attributes: {
              SyntheticValidDynamicKey: "SyntheticValidDynamicValue",
              category: "SyntheticValidCategory",
              detail: "SyntheticValidDetail",
              response: "SyntheticValidResponse",
            },
            links: [
              {
                context: {
                  traceId: "1".repeat(32),
                  spanId: "2".repeat(16),
                  traceFlags: 1,
                  traceState,
                },
                attributes: { visible: "SyntheticValidLink" },
              },
            ],
          },
          trace.setSpanContext(context.active(), {
            traceId: "3".repeat(32),
            spanId: "4".repeat(16),
            traceFlags: 1,
            traceState,
          })
        );
      span.addEvent("SyntheticValidEvent", {
        payload: "SyntheticValidPayload",
      });
      span.recordException(new Error("SyntheticValidException"));
      span.end();
      await provider.forceFlush();

      expect(requests).toHaveLength(1);
      expect(requests[0]).not.toContain("SyntheticValid");
      expect(requests[0]).toContain("exception");
    } finally {
      await provider.shutdown();
      server.stop(true);
    }
  });
});
