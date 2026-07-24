import {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import { EmailServiceError } from "@deskohub/email";
import {
  type AnyValue,
  type AnyValueMap,
  type LoggerProvider,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Logger, type LogLevel, References } from "effect";
import { PublicSafeActionError } from "../../utils/safe-action-client";
import { StorageError } from "../errors";

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
  "subject",
] as const;

const sensitiveLogExactKeys = new Set([
  "addressline1",
  "addressline2",
  "barcode",
  "birthday",
  "city",
  "companyid",
  "companyname",
  "country",
  "description",
  "detail",
  "discountcode",
  "error",
  "expiredate",
  "externalid",
  "headerprint",
  "hexcolor",
  "internalnote",
  "modifiedby",
  "note",
  "exception.stacktrace",
  "submittedcode",
  "stack",
  "tags",
  "vatid",
  "x-vercel-sc-headers",
  "zip",
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

const redactUrlSearchParams = (url: URL): void => {
  for (const key of Array.from(url.searchParams.keys())) {
    if (isSensitiveLogRecordKey(key)) {
      url.searchParams.set(key, CENSORED_LOG_VALUE);
    }
  }
};

const censorUrlString = (value: string) => {
  let absoluteUrl: URL | undefined;

  try {
    absoluteUrl = new URL(value);
  } catch {
    absoluteUrl = undefined;
  }

  if (absoluteUrl) {
    if (absoluteUrl.protocol !== "http:" && absoluteUrl.protocol !== "https:") {
      return value;
    }

    redactUrlSearchParams(absoluteUrl);
    return absoluteUrl.toString();
  }

  const isQueryOnlyRelativeUrl = value.startsWith("?");
  const isPathRelativeUrl = value.startsWith("/");
  const isBareRelativeUrlWithQuery = value.includes("?");

  if (
    !(isPathRelativeUrl || isQueryOnlyRelativeUrl || isBareRelativeUrlWithQuery)
  ) {
    return value;
  }

  try {
    const relativeUrl = new URL(value, "https://deskohub.local");
    redactUrlSearchParams(relativeUrl);

    if (value.startsWith("//")) {
      return `//${relativeUrl.host}${relativeUrl.pathname}${relativeUrl.search}${relativeUrl.hash}`;
    }

    if (!(isPathRelativeUrl || isQueryOnlyRelativeUrl)) {
      return `${relativeUrl.pathname.slice(1)}${relativeUrl.search}${relativeUrl.hash}`;
    }

    return isQueryOnlyRelativeUrl
      ? `${relativeUrl.search}${relativeUrl.hash}`
      : `${relativeUrl.pathname}${relativeUrl.search}${relativeUrl.hash}`;
  } catch {
    return value;
  }
};

const isEffectDrizzleQueryError = (
  value: unknown
): value is EffectDrizzleQueryError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "EffectDrizzleQueryError";

const isPlainDotyposProviderError = (
  value: unknown
): value is Record<string, unknown> =>
  isPlainObject(value) &&
  !("_tag" in value) &&
  Object.keys(value).every((key) =>
    ["code", "error", "errorDescription"].includes(key)
  ) &&
  ("errorDescription" in value ||
    ("error" in value && ("code" in value || Object.keys(value).length <= 2)));

const serializedKnownErrorTags = new Set([
  "EmailServiceError",
  "ExternalAPIError",
  "NetworkError",
  "PublicSafeActionError",
  "StorageError",
  "ValidationError",
]);

const getSerializedKnownErrorTag = (value: unknown): string | undefined => {
  if (!isPlainObject(value)) return undefined;
  const tag =
    typeof value._tag === "string"
      ? value._tag
      : typeof value.name === "string"
        ? value.name
        : undefined;
  return tag && serializedKnownErrorTags.has(tag) ? tag : undefined;
};

const projectTrustedErrorMetadata = (
  value: object,
  seen: WeakMap<object, unknown>
): unknown => {
  const existing = seen.get(value);
  if (existing) return existing;

  if (value instanceof EmailServiceError) {
    const result = { _tag: "EmailServiceError" };
    seen.set(value, result);
    return result;
  }

  if (value instanceof ExternalAPIError) {
    const result = {
      _tag: "ExternalAPIError",
      operation: value.operation,
      ...(typeof value.statusCode === "number" && {
        statusCode: value.statusCode,
      }),
    };
    seen.set(value, result);
    return result;
  }

  if (value instanceof NetworkError) {
    const result = { _tag: "NetworkError" };
    seen.set(value, result);
    return result;
  }

  if (value instanceof ValidationError) {
    const result = { _tag: "ValidationError" };
    seen.set(value, result);
    return result;
  }

  if (value instanceof StorageError) {
    const result: Record<string, unknown> = { _tag: "StorageError" };
    seen.set(value, result);
    if (value.operation) result.operation = value.operation;
    if (typeof value.cause === "object" && value.cause !== null) {
      const cause = censorErrorCause(value.cause, seen);
      if (cause !== CENSORED_LOG_VALUE) result.cause = cause;
    }
    return result;
  }

  if (value instanceof PublicSafeActionError) {
    const result: Record<string, unknown> = { _tag: "PublicSafeActionError" };
    seen.set(value, result);
    const cause = censorErrorCause(value.cause, seen);
    if (cause !== CENSORED_LOG_VALUE) {
      result.cause = cause;
    }
    return result;
  }

  if (value instanceof Error) {
    const result = { _tag: "Error" };
    seen.set(value, result);
    return result;
  }

  return CENSORED_LOG_VALUE;
};

const projectSerializedKnownError = (
  value: Record<string, unknown>,
  seen: WeakMap<object, unknown>
): unknown => {
  const tag = getSerializedKnownErrorTag(value);
  if (!tag) return CENSORED_LOG_VALUE;

  const existing = seen.get(value);
  if (existing) return existing;

  const result: Record<string, unknown> = { _tag: tag };
  seen.set(value, result);
  if (tag === "ExternalAPIError" && typeof value.statusCode === "number") {
    result.statusCode = value.statusCode;
  }
  return result;
};

function censorErrorCause(
  value: unknown,
  seen: WeakMap<object, unknown>
): unknown {
  if (typeof value !== "object" || value === null) return CENSORED_LOG_VALUE;

  if (
    Cause.isCause(value) ||
    isPlainDotyposProviderError(value) ||
    isEffectDrizzleQueryError(value) ||
    value instanceof EmailServiceError ||
    value instanceof ExternalAPIError ||
    value instanceof NetworkError ||
    value instanceof PublicSafeActionError ||
    value instanceof StorageError ||
    value instanceof ValidationError ||
    value instanceof Error ||
    getSerializedKnownErrorTag(value) !== undefined
  ) {
    return censorLogValueInternal(value, seen);
  }

  return CENSORED_LOG_VALUE;
}

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
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "error" || normalizedKey === "cause") {
    return censorErrorCause(value, seen);
  }
  if (isSensitiveLogRecordKey(key)) return CENSORED_LOG_VALUE;
  if (normalizedKey === "params") return censorQueryParams(value, seen);
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

  if (typeof value === "string") return censorUrlString(value);

  if (Cause.isCause(value)) {
    const existing = seen.get(value);
    if (existing) return existing;
    seen.set(value, Cause.empty);
    const result = Cause.fromReasons(
      value.reasons.map((reason) =>
        Cause.isFailReason(reason)
          ? Cause.makeFailReason(censorErrorCause(reason.error, seen))
          : Cause.isDieReason(reason)
            ? Cause.makeDieReason(censorErrorCause(reason.defect, seen))
            : Cause.makeInterruptReason(reason.fiberId)
      )
    );
    seen.set(value, result);
    return result;
  }

  if (isEffectDrizzleQueryError(value)) {
    const existing = seen.get(value);
    if (existing) return existing;

    const result: Record<string, unknown> = {
      _tag: value._tag,
      query: value.query,
    };
    seen.set(value, result);
    result.params = censorQueryParams(value.params, seen);
    return result;
  }

  if (
    value instanceof EmailServiceError ||
    value instanceof ExternalAPIError ||
    value instanceof NetworkError ||
    value instanceof PublicSafeActionError ||
    value instanceof StorageError ||
    value instanceof ValidationError ||
    value instanceof Error
  ) {
    return projectTrustedErrorMetadata(value, seen);
  }

  if (isPlainDotyposProviderError(value)) {
    return {
      ...("code" in value &&
        typeof value.code === "number" && { code: value.code }),
    };
  }

  if (isPlainObject(value) && getSerializedKnownErrorTag(value) !== undefined) {
    return projectSerializedKnownError(value, seen);
  }

  if (!isPlainObject(value)) return value;

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
    cause: censorLogValue(options.cause) as typeof options.cause,
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

  try {
    return JSON.stringify(
      Cause.isCause(value)
        ? value.reasons.map((reason) =>
            Cause.isFailReason(reason)
              ? { _tag: "Fail", error: reason.error }
              : Cause.isDieReason(reason)
                ? { _tag: "Die", defect: reason.defect }
                : { _tag: "Interrupt" }
          )
        : value
    );
  } catch {
    return String(value);
  }
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
      name: isException ? "exception" : event.name,
    };
  }),
  instrumentationScope: span.instrumentationScope,
  kind: span.kind,
  links: span.links.map((link) => ({
    ...link,
    attributes: censorTelemetryValue(link.attributes) as typeof link.attributes,
  })),
  name: span.name,
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

  for (const key of trustedOtelResourceIdentityKeys) {
    const value = attributes[key];
    if (value !== undefined) censored[key] = value;
  }

  return censored;
};

export const WorkspaceLoggerLive = Logger.layer([CensoringLogger]);

export const createWorkspaceOtelLoggerLive = (loggerProvider: LoggerProvider) =>
  Logger.layer([CensoringLogger, createCensoredOtelLogger(loggerProvider)]);
