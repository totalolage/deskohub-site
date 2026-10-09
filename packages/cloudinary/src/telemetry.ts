import type {
  Attributes,
  AttributeValue,
  SpanStatus,
  TimeInput,
} from "@opentelemetry/api";
import type { Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * A signed Cloudinary URL carries its signature as an `s--<signature>--` path
 * segment, derived from the API secret.
 */
const signaturePathSegment = /(^|\/)s--[\w-]+--(?=$|[/?#\s])/g;
const redactedSignaturePathSegment = "s--REDACTED--";

/** Replaces every Cloudinary URL signature segment in `text`. */
export const redactCloudinarySignatures = (text: string): string =>
  text.replace(signaturePathSegment, `$1${redactedSignaturePathSegment}`);

type StringArrayAttributeValue = Array<string | null | undefined>;

const isStringArray = (
  value: AttributeValue
): value is StringArrayAttributeValue =>
  Array.isArray(value) &&
  value.every((item) => item == null || typeof item === "string");

/** Returns `value` itself when it carries no signature. */
const redactAttributeValue = (value: AttributeValue): AttributeValue => {
  if (typeof value === "string") return redactCloudinarySignatures(value);
  if (!isStringArray(value)) return value;

  const redacted = value.map((item) =>
    item == null ? item : redactCloudinarySignatures(item)
  );
  return redacted.every((item, index) => item === value[index])
    ? value
    : redacted;
};

const redactAttributes = (attributes: Attributes): Attributes =>
  Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      value === undefined ? value : redactAttributeValue(value),
    ])
  );

const isAttributes = (
  value: Attributes | TimeInput | undefined
): value is Attributes =>
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const redactStatus = (status: SpanStatus): SpanStatus =>
  status.message === undefined
    ? status
    : { ...status, message: redactCloudinarySignatures(status.message) };

/**
 * Routes every later name, attribute, event, and status write on `span`
 * through the signature redaction, whichever instrumentation performs it.
 */
const redactSpanWrites = (span: Span) => {
  const updateName = span.updateName.bind(span);
  const setAttribute = span.setAttribute.bind(span);
  const setAttributes = span.setAttributes.bind(span);
  const addEvent = span.addEvent.bind(span);
  const setStatus = span.setStatus.bind(span);

  span.updateName = (name) => updateName(redactCloudinarySignatures(name));
  span.setAttribute = (key, value) =>
    setAttribute(
      key,
      value === undefined ? value : redactAttributeValue(value)
    );
  span.setAttributes = (attributes) =>
    setAttributes(redactAttributes(attributes));
  span.addEvent = (name, attributesOrStartTime, startTime) =>
    addEvent(
      redactCloudinarySignatures(name),
      isAttributes(attributesOrStartTime)
        ? redactAttributes(attributesOrStartTime)
        : attributesOrStartTime,
      startTime
    );
  span.setStatus = (status) => setStatus(redactStatus(status));
};

/**
 * Span processor that keeps signed Cloudinary URLs out of every exported
 * span. Fetch and HTTP instrumentations record the full request URL in the
 * span name and URL attributes; this processor rewrites the signature segment
 * of the name and attributes a span starts with, and of every later write.
 *
 * Register it ahead of all exporting processors of a tracer provider, for
 * example `registerOTel({ spanProcessors: [new
 * CloudinarySignatureRedactor(), "auto"] })`.
 */
export class CloudinarySignatureRedactor implements SpanProcessor {
  onStart(span: Span): void {
    redactSpanWrites(span);

    const name = redactCloudinarySignatures(span.name);
    if (name !== span.name) span.updateName(name);

    for (const [key, value] of Object.entries(span.attributes)) {
      if (value === undefined) continue;
      const redacted = redactAttributeValue(value);
      if (redacted !== value) span.setAttribute(key, redacted);
    }
  }

  onEnd(): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
