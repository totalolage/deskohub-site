import { context } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";

/**
 * The global `fetch`, called with OpenTelemetry tracing suppressed. Fetch and
 * HTTP instrumentations (such as `@vercel/otel`) and Next.js' own fetch spans
 * then start non-recording spans, so the request URL reaches no span. Use it
 * for requests whose URL carries a credential, such as a signed URL.
 *
 * Resolves `globalThis.fetch` on every call so later patches still apply.
 */
export const untracedFetch: typeof globalThis.fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) =>
    context.with(suppressTracing(context.active()), () =>
      globalThis.fetch(input, init)
    ),
  {
    preconnect: (...args: Parameters<typeof globalThis.fetch.preconnect>) =>
      globalThis.fetch.preconnect(...args),
  }
);
