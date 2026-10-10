import { afterEach, describe, expect, test } from "bun:test";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  CloudinarySignatureRedactor,
  redactCloudinarySignatures,
} from "./telemetry";

const syntheticSignature = "s--fake-signature--";
const signedUrl = `https://res.cloudinary.test/demo/image/list/${syntheticSignature}/gallery.json`;
const redactedUrl =
  "https://res.cloudinary.test/demo/image/list/s--REDACTED--/gallery.json";

/** Everything a span exporter could send: names, attributes, events, status. */
const recordedText = (exporter: InMemorySpanExporter) =>
  JSON.stringify(
    exporter.getFinishedSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    }))
  );

describe("redactCloudinarySignatures", () => {
  test("replaces signature path segments", () => {
    expect(redactCloudinarySignatures(signedUrl)).toBe(redactedUrl);
    expect(redactCloudinarySignatures(`fetch GET ${signedUrl}`)).toBe(
      `fetch GET ${redactedUrl}`
    );
    expect(
      redactCloudinarySignatures(`${syntheticSignature}/gallery.json`)
    ).toBe("s--REDACTED--/gallery.json");
    expect(
      redactCloudinarySignatures(
        `https://res.cloudinary.test/demo/image/upload/${syntheticSignature}?x=1`
      )
    ).toBe("https://res.cloudinary.test/demo/image/upload/s--REDACTED--?x=1");
  });

  test("leaves text without a signature segment unchanged", () => {
    const unsigned =
      "https://res.cloudinary.test/demo/image/upload/v1/gallery/s--not-a-segment.jpg";
    expect(redactCloudinarySignatures(unsigned)).toBe(unsigned);
  });
});

describe("CloudinarySignatureRedactor", () => {
  let provider: BasicTracerProvider | undefined;

  afterEach(async () => {
    await provider?.shutdown();
    provider = undefined;
  });

  const exportedSpans = () => {
    const exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [
        new CloudinarySignatureRedactor(),
        new SimpleSpanProcessor(exporter),
      ],
    });
    return { exporter, tracer: provider.getTracer("telemetry-test") };
  };

  test("redacts the name and attributes a span starts with", () => {
    const { exporter, tracer } = exportedSpans();

    tracer
      .startSpan(`fetch GET ${signedUrl}`, {
        attributes: {
          "http.url": signedUrl,
          "url.full": [signedUrl, "unrelated"],
          "http.status_code": 200,
        },
      })
      .end();

    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe(`fetch GET ${redactedUrl}`);
    expect(span?.attributes).toEqual({
      "http.url": redactedUrl,
      "url.full": [redactedUrl, "unrelated"],
      "http.status_code": 200,
    });
    expect(recordedText(exporter)).not.toContain(syntheticSignature);
  });

  test("redacts names, attributes, events, and statuses written later", () => {
    const { exporter, tracer } = exportedSpans();

    const span = tracer.startSpan("fetch");
    span.updateName(`fetch GET ${signedUrl}`);
    span.setAttribute("http.url", signedUrl);
    span.setAttributes({ "url.full": signedUrl, "resource.name": signedUrl });
    span.addEvent(`request ${signedUrl}`, { "http.url": signedUrl });
    span.recordException(new Error(`request to ${signedUrl} failed`));
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `request to ${signedUrl} failed`,
    });
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.name).toBe(`fetch GET ${redactedUrl}`);
    expect(exported?.attributes["http.url"]).toBe(redactedUrl);
    expect(exported?.events).toHaveLength(2);
    expect(exported?.status.message).toBe(`request to ${redactedUrl} failed`);
    expect(recordedText(exporter)).not.toContain(syntheticSignature);
  });
});
