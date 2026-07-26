import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SpanStatusCode } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { CENSORED_LOG_VALUE } from "../logging/censorship";
import { createWorkspaceOtelConfiguration } from "./workspace-otel";

describe("workspace production OTel configuration", () => {
  test("censors spans before the automatic production exporter", async () => {
    const marker = randomUUID();
    const credentialUrl = `https://provider.invalid/hpp/${marker}?opaque=${marker}`;
    const config = createWorkspaceOtelConfiguration();
    const [censor, automatic] = config.spanProcessors ?? [];
    expect(automatic).toBe("auto");
    expect(censor).not.toBe("auto");

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        "service.name": "workspace-production-path-test",
        providerRedirectUrl: credentialUrl,
      }),
      spanProcessors: [
        censor as SpanProcessor,
        new SimpleSpanProcessor(exporter),
      ],
    });
    const tracer = provider.getTracer("workspace-production-path-test");
    const span = tracer.startSpan(credentialUrl, {
      attributes: {
        hostedPage: credentialUrl,
        "url.full": credentialUrl,
        "db.statement": `update payment_attempts set security_token = '${marker}'`,
        "db.query.parameter.0": marker,
        "db.bind.parameters": marker,
        harmlessUrl: `https://example.invalid/path?opaque=${marker}`,
      },
      links: [
        {
          context: {
            traceId: "00000000000000000000000000000001",
            spanId: "0000000000000001",
            traceFlags: 1,
          },
          attributes: { sessionUrl: credentialUrl },
        },
      ],
    });
    span.addEvent("provider.attach.failed", {
      "exception.message": marker,
      "exception.stacktrace": marker,
      "http.url": credentialUrl,
    });
    const dynamicException = new Error(marker);
    dynamicException.name = marker;
    span.recordException(dynamicException);
    span.setStatus({ code: SpanStatusCode.ERROR, message: marker });
    span.end();
    await provider.forceFlush();

    const [exported] = exporter.getFinishedSpans();
    const serialized = JSON.stringify({
      attributes: exported?.attributes,
      events: exported?.events,
      links: exported?.links,
      name: exported?.name,
      resource: exported?.resource.attributes,
      status: exported?.status,
    });
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain(credentialUrl);
    await provider.shutdown();
  });
});
