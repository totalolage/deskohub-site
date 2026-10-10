import { CloudinarySignatureRedactor } from "@deskohub/cloudinary/telemetry";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * Span processors that scrub credentials, such as signed Cloudinary URL
 * signatures, from span names and attributes. List them ahead of every
 * exporting span processor of a workspace tracer provider, whichever
 * instrumentation records the span.
 */
export const createWorkspaceSpanRedactors = (): SpanProcessor[] => [
  new CloudinarySignatureRedactor(),
];
