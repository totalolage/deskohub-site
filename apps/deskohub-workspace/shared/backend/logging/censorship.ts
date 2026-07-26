import {
  type AnyValue,
  type AnyValueMap,
  type LoggerProvider,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import type {
  ReadableSpan,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Logger, type LogLevel, References } from "effect";
import { projectErrorMetadata } from "@/shared/utils/error-metadata";

export const CENSORED_LOG_VALUE = "[REDACTED]";

const sensitiveLogKeyFragments = [
  "password",
  "passwd",
  "pwd",
  "token",
  "access token",
  "access code",
  "refresh token",
  "id token",
  "secret",
  "client secret",
  "api key",
  "signature",
  "authorization",
  "auth",
  "cookie",
  "set cookie",
  "session cookie",
  "session secret",
  "session token",
  "name",
  "message",
  "error description",
  "email",
  "phone",
  "first name",
  "last name",
  "id",
  "identifier",
  "key",
  "digest",
  "hash",
  "fingerprint",
  "url",
  "state",
] as const;

const sensitiveLogExactKeys = new Set([
  "discountcode",
  "db.statement",
  "exception.stacktrace",
  "submittedcode",
  "x-vercel-sc-headers",
]);

const sensitiveLogUrlSearchParams = new Set([
  "checkouttoken",
  "paystate",
  "paystateref",
  "x-vercel-protection-bypass",
  "token",
  "state",
  "secret",
  "name",
  "message",
]);

const isSensitiveLogUrlSearchParam = (key: string): boolean =>
  sensitiveLogUrlSearchParams.has(key.toLowerCase());

const isSensitiveLogRecordKey = (key: string): boolean =>
  isSensitiveLogKey(key) || isSensitiveLogUrlSearchParam(key);

const splitSensitiveLogKeyFragment = (fragment: string) => fragment.split(" ");

const sensitiveLogKeyFragmentWords = sensitiveLogKeyFragments.map(
  splitSensitiveLogKeyFragment
);

const logKeyWordPattern = /[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/g;
const logKeySegmentPattern = /[a-z0-9]+/gi;

const tokenizeLogKey = (key: string): readonly string[] =>
  Array.from(key.matchAll(logKeyWordPattern), ([word]) => word.toLowerCase());

const segmentLogKey = (key: string): readonly string[] =>
  Array.from(key.matchAll(logKeySegmentPattern), ([segment]) =>
    segment.toLowerCase()
  );

const wordsIncludeSensitiveLogKeyFragment = (
  words: readonly string[],
  fragmentWords: readonly string[]
): boolean => {
  if (fragmentWords.length > words.length) return false;

  for (
    let start = 0;
    start <= words.length - fragmentWords.length;
    start += 1
  ) {
    if (
      fragmentWords.every(
        (fragmentWord, index) => words[start + index] === fragmentWord
      )
    ) {
      return true;
    }
  }

  return false;
};

const containsSensitiveLogKeyFragmentSegment = (key: string): boolean => {
  const segments = segmentLogKey(key);

  return sensitiveLogKeyFragmentWords.some((fragmentWords) =>
    wordsIncludeSensitiveLogKeyFragment(segments, fragmentWords)
  );
};

const endsWithSensitiveLogKeyFragment = (key: string): boolean => {
  const words = tokenizeLogKey(key);

  return sensitiveLogKeyFragmentWords.some((fragmentWords) => {
    if (fragmentWords.length > words.length) return false;

    return fragmentWords.every(
      (fragmentWord, index) =>
        words[words.length - fragmentWords.length + index] === fragmentWord
    );
  });
};

export const isSensitiveLogKey = (key: string): boolean =>
  sensitiveLogExactKeys.has(key.toLowerCase()) ||
  containsSensitiveLogKeyFragmentSegment(key) ||
  endsWithSensitiveLogKeyFragment(key);

const isMap = (value: unknown): value is Map<unknown, unknown> =>
  value instanceof Map;

const isHeaders = (value: unknown): value is Headers =>
  typeof Headers !== "undefined" && value instanceof Headers;

const isURLSearchParams = (value: unknown): value is URLSearchParams =>
  typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isEffectDrizzleQueryError = (
  value: unknown
): value is EffectDrizzleQueryError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "EffectDrizzleQueryError";

const codeOwnedTelemetryNames = new Set([
  "@effect/opentelemetry",
  "checkout.advertised-price.load",
  "checkout.apply-discount-code",
  "checkout.pay.load",
  "checkout.payment-return",
  "checkout.prepare-pay-state",
  "checkout.provider-log-projection",
  "checkout.result.refresh",
  "checkout.submit-reservation",
  "cloudinaryWebhook",
  "contact.submit",
  "e2e.case",
  "e2e.run",
  "e2e.step",
  "events.list",
  "gallery.images.load",
  "meeting-room.page-enabled",
  "nexiWebhook",
  "operation",
  "reservationHoldCleanupCron",
  "resendWebhook",
  "safe.operation",
  "telemetry.flush",
  "test.action",
  "test.cause-projection",
  "test.checkout-state-failure",
  "test.continue",
  "test.defect",
  "test.failure",
  "test.interrupt",
  "test.layer-failure",
  "test.nested-cause-failure",
  "test.public-failure",
  "test.route",
  "test.run",
  "test.state-action",
  "test.task",
  "test.task-defect",
  "test.task-failure",
  "workspace.availability.load",
  "workspaceAvailability",
  "workspaceLocationMap.get",
]);

const codeOwnedTelemetryEnumValues = new Set([
  "action",
  "aggregate_error",
  "array",
  "bigint",
  "boolean",
  "cancelled",
  "cancelling",
  "case",
  "ci",
  "confirmed",
  "confirming",
  "continue-after-disconnect",
  "cowork",
  "custom",
  "created",
  "creating_hold",
  "cs-CZ",
  "debug",
  "defect",
  "development",
  "draft",
  "en-US",
  "error",
  "expired",
  "failed",
  "fatal",
  "fulfilled",
  "held",
  "HEAD",
  "hold_expired",
  "info",
  "internal",
  "interrupt-on-disconnect",
  "manual",
  "meeting-room",
  "nexi",
  "native",
  "nodejs",
  "not_started",
  "null",
  "number",
  "object",
  "paid",
  "PATCH",
  "passed",
  "pending",
  "preview",
  "POST",
  "PUT",
  "processing",
  "production",
  "route",
  "run",
  "step",
  "string",
  "symbol",
  "task",
  "timed_out",
  "timeout",
  "trace",
  "undefined",
  "warn",
  "DELETE",
  "GET",
  "OPTIONS",
]);

const codeOwnedTelemetryEnumKeys = new Set([
  "boundary",
  "category",
  "currency",
  "deployment.environment.name",
  "e2e.execution_context",
  "e2e.failure.kind",
  "e2e.outcome",
  "e2e.scope",
  "failureKind",
  "fulfillmentState",
  "kind",
  "locale",
  "method",
  "outcome",
  "paymentState",
  "provider",
  "reservationKind",
  "reservationState",
  "severityText",
  "shape",
  "state",
  "status",
  "vercel.runtime",
]);

const codeOwnedTelemetryBooleanKeys = new Set([
  "accepted",
  "providerResponseReceived",
  "responseReceived",
]);

const codeOwnedTelemetryCountKeys = new Set([
  "documentCount",
  "e2e.timeout_ms",
  "fieldCount",
  "github.pull_request.number",
  "github.run.attempt",
  "legalDocumentCount",
  "limit",
  "statusCode",
  "timeoutMs",
]);

const projectTelemetryNumber = (key: string, value: number): unknown => {
  if (!codeOwnedTelemetryCountKeys.has(key) || !Number.isFinite(value)) {
    return CENSORED_LOG_VALUE;
  }
  if (key === "statusCode") {
    return Number.isInteger(value) && value >= 100 && value <= 599
      ? value
      : CENSORED_LOG_VALUE;
  }
  return Math.min(1_000_000, Math.max(0, Math.trunc(value)));
};

const projectTelemetryString = (key: string, value: string): string => {
  if (key === "operation" && codeOwnedTelemetryNames.has(value)) return value;
  if (
    codeOwnedTelemetryEnumKeys.has(key) &&
    codeOwnedTelemetryEnumValues.has(value)
  ) {
    return value;
  }
  return CENSORED_LOG_VALUE;
};

const censorQueryParameter = (
  value: unknown,
  seen: WeakMap<object, unknown>
): unknown => {
  if (typeof value !== "string") {
    return censorLogValueInternal(value, seen);
  }

  try {
    return JSON.stringify(
      censorLogValueInternal(JSON.parse(value) as unknown, seen)
    );
  } catch {
    return censorLogValueInternal(value, seen);
  }
};

const censorQueryParams = (
  value: unknown,
  seen: WeakMap<object, unknown>
): unknown => {
  if (!Array.isArray(value)) return censorLogValueInternal(value, seen);

  const existing = seen.get(value);
  if (existing) return existing;

  const result: unknown[] = [];
  seen.set(value, result);

  for (let index = 0; index < value.length; index += 1) {
    if (index in value) {
      result[index] = censorQueryParameter(value[index], seen);
    }
  }

  return result;
};

const censorLogRecordValue = (
  key: string,
  value: unknown,
  seen: WeakMap<object, unknown>
): unknown => {
  if (
    key.toLowerCase() === "cause" ||
    key.toLowerCase() === "error" ||
    key.toLowerCase() === "errors" ||
    key.toLowerCase() === "thrown"
  ) {
    return projectErrorMetadata(value);
  }
  if (typeof value === "string") return projectTelemetryString(key, value);
  if (typeof value === "number") return projectTelemetryNumber(key, value);
  if (typeof value === "boolean") {
    return codeOwnedTelemetryBooleanKeys.has(key) ? value : CENSORED_LOG_VALUE;
  }
  if (key.toLowerCase() === "params") return censorQueryParams(value, seen);
  if (isSensitiveLogRecordKey(key)) return CENSORED_LOG_VALUE;
  return censorLogValueInternal(value, seen);
};

const censorLogValueInternal = (
  value: unknown,
  seen: WeakMap<object, unknown>
): unknown => {
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing) return existing;

    const result: unknown[] = [];
    seen.set(value, result);

    for (let index = 0; index < value.length; index += 1) {
      if (index in value) {
        result[index] = censorLogValueInternal(value[index], seen);
      }
    }

    return result;
  }

  if (isMap(value)) {
    const existing = seen.get(value);
    if (existing) return existing;

    const result = new Map<unknown, unknown>();
    seen.set(value, result);

    for (const [key, nestedValue] of value) {
      result.set(
        key,
        typeof key === "string"
          ? censorLogRecordValue(key, nestedValue, seen)
          : censorLogValueInternal(nestedValue, seen)
      );
    }

    return result;
  }

  if (isHeaders(value)) {
    const existing = seen.get(value);
    if (existing) return existing;

    const result = new Headers();
    seen.set(value, result);

    value.forEach((nestedValue, key) => {
      result.set(
        key,
        isSensitiveLogRecordKey(key)
          ? CENSORED_LOG_VALUE
          : String(censorLogValueInternal(nestedValue, seen))
      );
    });

    return result;
  }

  if (isURLSearchParams(value)) {
    const existing = seen.get(value);
    if (existing) return existing;

    const result = new URLSearchParams();
    seen.set(value, result);

    value.forEach((nestedValue, key) => {
      result.append(
        key,
        isSensitiveLogRecordKey(key)
          ? CENSORED_LOG_VALUE
          : String(censorLogValueInternal(nestedValue, seen))
      );
    });

    return result;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function" ||
    value === null ||
    value === undefined
  ) {
    return CENSORED_LOG_VALUE;
  }

  if (isEffectDrizzleQueryError(value)) {
    return projectErrorMetadata(value);
  }

  if (value instanceof Error) {
    return projectErrorMetadata(value);
  }

  if (!isPlainObject(value)) return projectErrorMetadata(value);

  const existing = seen.get(value);
  if (existing) return existing;

  const result: Record<string, unknown> = {};
  seen.set(value, result);

  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = censorLogRecordValue(key, nestedValue, seen);
  }

  return result;
};

export const censorTelemetryValue = (value: unknown): unknown =>
  censorLogValueInternal(value, new WeakMap());

export const censorLogValue = censorTelemetryValue;

export const censorLoggerOptions = (
  options: Logger.Options<unknown>
): Logger.Options<unknown> => {
  const fiber = options.fiber;

  return {
    ...options,
    message: censorLogValue(options.message),
    fiber: {
      ...fiber,
      getRef: (ref) => {
        const value = fiber.getRef(ref);
        if (ref !== References.CurrentLogAnnotations) return value;
        const annotations = value as Readonly<Record<string, unknown>>;

        return Object.fromEntries(
          Object.entries(annotations).map(([key, nestedValue]) => [
            key,
            censorLogRecordValue(key, nestedValue, new WeakMap()),
          ])
        ) as typeof value;
      },
    },
  };
};

const CensoringFormatter = Logger.make((options) =>
  Logger.formatLogFmt.log(censorLoggerOptions(options))
);

export const CensoringLogger = Logger.withLeveledConsole(CensoringFormatter);

const logLevelToOtelSeverity = (logLevel: LogLevel.LogLevel) => {
  switch (logLevel) {
    case "Fatal":
      return { severityNumber: SeverityNumber.FATAL, severityText: "fatal" };
    case "Error":
      return { severityNumber: SeverityNumber.ERROR, severityText: "error" };
    case "Warn":
      return { severityNumber: SeverityNumber.WARN, severityText: "warn" };
    case "Info":
      return { severityNumber: SeverityNumber.INFO, severityText: "info" };
    case "Debug":
      return { severityNumber: SeverityNumber.DEBUG, severityText: "debug" };
    default:
      return { severityNumber: SeverityNumber.TRACE, severityText: "trace" };
  }
};

const toOtelValue = (value: unknown): AnyValue => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return value as AnyValue;
};

const toOtelBody = (message: unknown): AnyValue => {
  if (!Array.isArray(message)) return toOtelValue(message);
  if (message.length === 1) return toOtelValue(message[0]);
  return message.map(toOtelValue);
};

export const createCensoredOtelLogger = (loggerProvider: LoggerProvider) =>
  Effect.sync(() =>
    Logger.make((rawOptions) => {
      const options = censorLoggerOptions(rawOptions);
      const otelLogger = loggerProvider.getLogger("@effect/opentelemetry");
      const { severityNumber, severityText } = logLevelToOtelSeverity(
        options.logLevel
      );
      const now = options.date.getTime();
      const attributes = { fiberId: `#${options.fiber.id}` } as AnyValueMap;

      for (const [key, value] of Object.entries(
        options.fiber.getRef(References.CurrentLogAnnotations)
      )) {
        attributes[key] = toOtelValue(value);
      }

      for (const [label, timestamp] of options.fiber.getRef(
        References.CurrentLogSpans
      )) {
        attributes[`logSpan.${label}`] = `${now - timestamp}ms`;
      }

      otelLogger.emit({
        attributes,
        body: toOtelBody(options.message),
        observedTimestamp: Date.now(),
        severityNumber,
        severityText,
        timestamp: options.date,
      });
    })
  );

export const createCensoredOtelSpanExporter = (
  spanExporter: SpanExporter
): SpanExporter => ({
  export: (spans, resultCallback) =>
    spanExporter.export(spans.map(censorReadableSpan), resultCallback),
  forceFlush: () => spanExporter.forceFlush?.() ?? Promise.resolve(),
  shutdown: () => spanExporter.shutdown(),
});

const censorSpanName = (name: string) =>
  codeOwnedTelemetryNames.has(name) ? name : "operation";

const replaceRecord = (
  target: Record<string, unknown>,
  replacement: Record<string, unknown>
) => {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, replacement);
};

const censorMutableSpan = (
  span: Parameters<SpanProcessor["onStart"]>[0]
): void => {
  replaceRecord(
    span.attributes,
    censorTelemetryValue(span.attributes) as Record<string, unknown>
  );
  replaceRecord(
    span.resource.attributes,
    censorOtelResourceAttributes(span.resource.attributes)
  );
  span.updateName(censorSpanName(span.name));
  if (span.status.message) {
    span.setStatus({ ...span.status, message: CENSORED_LOG_VALUE });
  }

  for (const event of span.events) {
    event.name = censorSpanName(event.name);
    if (event.attributes) {
      replaceRecord(
        event.attributes,
        censorTelemetryValue(event.attributes) as Record<string, unknown>
      );
    }
  }
  for (const link of span.links) {
    if (link.attributes) {
      replaceRecord(
        link.attributes,
        censorTelemetryValue(link.attributes) as Record<string, unknown>
      );
    }
  }
};

const censorReadableSpanInPlace = (span: ReadableSpan): void => {
  replaceRecord(
    span.attributes,
    censorTelemetryValue(span.attributes) as Record<string, unknown>
  );
  replaceRecord(
    span.resource.attributes,
    censorOtelResourceAttributes(span.resource.attributes)
  );

  const mutableSpan = span as ReadableSpan & {
    instrumentationScope: ReadableSpan["instrumentationScope"];
    name: string;
    status: ReadableSpan["status"];
  };
  mutableSpan.name = censorSpanName(span.name);
  mutableSpan.instrumentationScope = {
    ...span.instrumentationScope,
    name: censorSpanName(span.instrumentationScope.name),
    version: undefined,
    schemaUrl: undefined,
  };
  if (span.status.message) {
    mutableSpan.status = { ...span.status, message: CENSORED_LOG_VALUE };
  }

  for (const event of span.events) {
    event.name = censorSpanName(event.name);
    if (event.attributes) {
      replaceRecord(
        event.attributes,
        censorTelemetryValue(event.attributes) as Record<string, unknown>
      );
    }
  }
  for (const link of span.links) {
    if (link.attributes) {
      replaceRecord(
        link.attributes,
        censorTelemetryValue(link.attributes) as Record<string, unknown>
      );
    }
  }
};

export const CensoringSpanProcessor: SpanProcessor = {
  forceFlush: () => Promise.resolve(),
  onStart: () => undefined,
  onEnding: censorMutableSpan,
  onEnd: censorReadableSpanInPlace,
  shutdown: () => Promise.resolve(),
};

const censorReadableSpan = (span: ReadableSpan): ReadableSpan => ({
  attributes: censorTelemetryValue(
    span.attributes
  ) as ReadableSpan["attributes"],
  droppedAttributesCount: span.droppedAttributesCount,
  droppedEventsCount: span.droppedEventsCount,
  droppedLinksCount: span.droppedLinksCount,
  duration: span.duration,
  ended: span.ended,
  endTime: span.endTime,
  events: span.events.map((event) => {
    const attributes = censorTelemetryValue(
      event.attributes
    ) as typeof event.attributes;
    const isException =
      event.attributes !== undefined &&
      Object.keys(event.attributes).some((key) => key.startsWith("exception."));

    return {
      ...event,
      attributes,
      name: isException ? "exception" : censorSpanName(event.name),
    };
  }),
  instrumentationScope: {
    ...span.instrumentationScope,
    name: censorSpanName(span.instrumentationScope.name),
    version: undefined,
    schemaUrl: undefined,
  },
  kind: span.kind,
  links: span.links.map((link) => ({
    ...link,
    attributes: censorTelemetryValue(link.attributes) as typeof link.attributes,
  })),
  name: censorSpanName(span.name),
  parentSpanContext: span.parentSpanContext,
  resource: resourceFromAttributes(
    censorOtelResourceAttributes(span.resource.attributes),
    span.resource.schemaUrl ? { schemaUrl: span.resource.schemaUrl } : undefined
  ),
  spanContext: () => span.spanContext(),
  startTime: span.startTime,
  status: span.status.message
    ? { ...span.status, message: CENSORED_LOG_VALUE }
    : span.status,
});

const trustedOtelResourceIdentityKeys = [
  "service.name",
  "telemetry.sdk.name",
] as const;

const censorOtelResourceAttributes = (
  attributes: ReadableSpan["resource"]["attributes"]
): ReadableSpan["resource"]["attributes"] => {
  const censored = censorTelemetryValue(
    attributes
  ) as ReadableSpan["resource"]["attributes"];

  const trustedResourceValues = new Set([
    "deskohub",
    "deskohub-workspace",
    "deskohub-workspace-e2e",
    "opentelemetry",
  ]);

  for (const key of trustedOtelResourceIdentityKeys) {
    const value = attributes[key];
    if (typeof value === "string" && trustedResourceValues.has(value)) {
      censored[key] = value;
    }
  }

  const namespace = attributes["service.namespace"];
  if (namespace === "deskohub") censored["service.namespace"] = namespace;
  const environment = attributes["deployment.environment.name"];
  if (
    typeof environment === "string" &&
    codeOwnedTelemetryEnumValues.has(environment)
  ) {
    censored["deployment.environment.name"] = environment;
  }

  return censored;
};

const censorReadableLogRecord = (
  record: ReadableLogRecord
): ReadableLogRecord => ({
  ...record,
  attributes: censorTelemetryValue(
    record.attributes
  ) as ReadableLogRecord["attributes"],
  body:
    record.body === undefined
      ? undefined
      : (censorTelemetryValue(record.body) as ReadableLogRecord["body"]),
  eventName: record.eventName
    ? censorSpanName(record.eventName)
    : record.eventName,
  instrumentationScope: {
    ...record.instrumentationScope,
    name: censorSpanName(record.instrumentationScope.name),
    version: undefined,
    schemaUrl: undefined,
    attributes: record.instrumentationScope.attributes
      ? (censorTelemetryValue(
          record.instrumentationScope.attributes
        ) as NonNullable<
          ReadableLogRecord["instrumentationScope"]["attributes"]
        >)
      : undefined,
  },
  severityText:
    record.severityText &&
    codeOwnedTelemetryEnumValues.has(record.severityText.toLowerCase())
      ? record.severityText.toLowerCase()
      : undefined,
  resource: resourceFromAttributes(
    censorOtelResourceAttributes(record.resource.attributes),
    record.resource.schemaUrl
      ? { schemaUrl: record.resource.schemaUrl }
      : undefined
  ),
});

export const createCensoredOtelLogExporter = (
  exporter: LogRecordExporter
): LogRecordExporter => ({
  export: (records, resultCallback) =>
    exporter.export(records.map(censorReadableLogRecord), resultCallback),
  forceFlush: () => exporter.forceFlush(),
  shutdown: () => exporter.shutdown(),
});

export const WorkspaceLoggerLive = Logger.layer([CensoringLogger]);

export const createWorkspaceOtelLoggerLive = (loggerProvider: LoggerProvider) =>
  Logger.layer([CensoringLogger, createCensoredOtelLogger(loggerProvider)]);
