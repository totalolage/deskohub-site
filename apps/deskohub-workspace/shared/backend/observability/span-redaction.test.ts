import { describe, expect, test } from "bun:test";
import http from "node:http";
import https from "node:https";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { FetchInstrumentation } from "@vercel/otel";
import { createWorkspaceSpanRedactors } from "./span-redaction";

/** Stand-in for a Cloudinary URL signature; never a real signature. */
const syntheticSignature = "s--fake-signature--";
const signedUrl = `https://res.cloudinary.test/demo/image/list/${syntheticSignature}/gallery.json`;

describe("createWorkspaceSpanRedactors", () => {
  test("keeps signed Cloudinary URLs out of spans exported for instrumented fetches", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        ...createWorkspaceSpanRedactors(),
        new SimpleSpanProcessor(exporter),
      ],
    });
    const contextManager = new AsyncLocalStorageContextManager().enable();
    const instrumentation = new FetchInstrumentation();
    const platformFetch = globalThis.fetch;
    const platformHttp = { request: http.request, get: http.get };
    const platformHttps = { request: https.request, get: https.get };
    const fetchDisabledByInstrumentation = process.env.NEXT_OTEL_FETCH_DISABLED;
    const fakeFetch = Object.assign(
      () => Promise.resolve(Response.json({ resources: [] })),
      { preconnect: platformFetch.preconnect }
    );

    context.setGlobalContextManager(contextManager);
    globalThis.fetch = fakeFetch;
    try {
      // The `@vercel/otel` fetch instrumentation that `registerOTel` installs
      // names the span after the full request URL.
      instrumentation.setTracerProvider(provider);
      instrumentation.enable();

      const response = await globalThis.fetch(signedUrl);
      await response.json();
      // The instrumentation ends the span once it has measured the body.
      for (
        let attempt = 0;
        attempt < 100 && exporter.getFinishedSpans().length === 0;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]?.name).toContain("s--REDACTED--");
      expect(spans[0]?.attributes["http.url"]).toContain("s--REDACTED--");
      expect(
        JSON.stringify(
          spans.map(({ name, attributes, events, status }) => ({
            name,
            attributes,
            events,
            status,
          }))
        )
      ).not.toContain(syntheticSignature);
    } finally {
      instrumentation.disable();
      globalThis.fetch = platformFetch;
      Object.assign(http, platformHttp);
      Object.assign(https, platformHttps);
      if (fetchDisabledByInstrumentation === undefined) {
        delete process.env.NEXT_OTEL_FETCH_DISABLED;
      } else {
        process.env.NEXT_OTEL_FETCH_DISABLED = fetchDisabledByInstrumentation;
      }
      context.disable();
      contextManager.disable();
      await provider.shutdown();
    }
  });
});
