import { isNativeError } from "node:util/types";
import {
  type AnyValue,
  type AnyValueMap,
  type LoggerProvider,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Cause,
  type Context,
  Effect,
  Logger,
  type LogLevel,
  Predicate,
  References,
} from "effect";
import { getSensitiveDatabaseQueryParameterIndexes } from "./database-query-parameter-classifier";

export const CENSORED_LOG_VALUE = "[REDACTED]";

type LogAnnotations = Context.Service.Shape<
  typeof References.CurrentLogAnnotations
>;
type MutableLogAnnotations = {
  -readonly [Key in keyof LogAnnotations]: LogAnnotations[Key];
};

const sensitiveLogKeyFragments = [
  "password",
  "passwd",
  "pin",
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
  "billing",
  "billing details",
  "address line 1",
  "address line 2",
  "company id",
  "vat id",
  "postal code",
] as const;

const sensitiveLogExactKeys = new Set([
  "address",
  "attachments",
  "city",
  "country",
  "description",
  "db.namespace",
  "discountcode",
  "recipient",
  "server.address",
  "submittedcode",
  "subject",
  "zip",
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
  "filter",
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

const isMap = <T>(value: T): value is T & Map<unknown, unknown> =>
  value instanceof Map;

const isHeaders = <T>(value: T): value is T & Headers =>
  globalThis.Headers !== undefined && value instanceof Headers;

const isURLSearchParams = <T>(value: T): value is T & URLSearchParams =>
  globalThis.URLSearchParams !== undefined && value instanceof URLSearchParams;

const isPlainObject = <T>(value: T): value is T & LogAnnotations => {
  if (!Predicate.isObject(value)) return false;

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

const censorStackFrameSource = (source: string): string | undefined => {
  const location = source.replace(/[?#].*$/, "");
  if (/^(?:\/(?!\/)|[A-Za-z]:[\\/])/.test(location)) return location;

  try {
    const isProtocolRelative = location.startsWith("//");
    const url = isProtocolRelative
      ? new URL(location, "https://deskohub.local")
      : new URL(location);
    url.username = "";
    url.password = "";
    return isProtocolRelative ? `//${url.host}${url.pathname}` : url.toString();
  } catch {
    return undefined;
  }
};

const censorStackTrace = (stack: string, message: string): string => {
  const messageMarker = stack.indexOf(": ");
  const firstLineEnd = stack.indexOf("\n");
  let framesStart = -1;
  if (message === "") {
    framesStart = firstLineEnd;
  } else if (
    messageMarker >= 0 &&
    stack.startsWith(message, messageMarker + 2)
  ) {
    framesStart = messageMarker + 2 + message.length;
  } else if (
    messageMarker < 0 &&
    firstLineEnd >= 0 &&
    /^[\t ]*at[\t ]/.test(stack.slice(firstLineEnd + 1))
  ) {
    framesStart = firstLineEnd;
  }
  if (framesStart < 0 || stack[framesStart] !== "\n") {
    return CENSORED_LOG_VALUE;
  }

  const frames = stack
    .slice(framesStart + 1)
    .split("\n")
    .flatMap((line) => {
      const frame = /^\s*at(?:\s+.*\s+\()?(.+):(\d+):(\d+)\)?$/.exec(line);
      if (!frame) return [];
      const source = frame[1]?.trim();
      const lineNumber = frame[2];
      const columnNumber = frame[3];
      if (!(source && lineNumber && columnNumber)) return [];
      if (
        !/^(?:\/|[A-Za-z]:[\\/]|(?:https?|file|node|bun|webpack|turbopack):)/.test(
          source
        )
      ) {
        return [];
      }
      const censoredSource = censorStackFrameSource(source);
      return censoredSource
        ? [`    at ${censoredSource}:${lineNumber}:${columnNumber}`]
        : [];
    });

  return frames.length === 0
    ? CENSORED_LOG_VALUE
    : `${CENSORED_LOG_VALUE}\n${frames.join("\n")}`;
};

const isEffectDrizzleQueryError = <T>(
  value: T
): value is T & EffectDrizzleQueryError =>
  Predicate.isObject(value) &&
  "_tag" in value &&
  value._tag === "EffectDrizzleQueryError";

const censorQueryParameter = <T>(
  value: T,
  seen: WeakMap<object, unknown>
): unknown => {
  if (!Predicate.isString(value)) {
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

const censorQueryParamsInternal = <T>(
  query: string | undefined,
  value: T,
  seen: WeakMap<object, unknown>
): unknown => {
  if (!Array.isArray(value)) return censorLogValueInternal(value, seen);

  const existing = seen.get(value);
  if (existing) return existing;

  const sensitiveIndexes = query
    ? getSensitiveDatabaseQueryParameterIndexes(query)
    : new Set<number>();
  const result: unknown[] = [];
  seen.set(value, result);

  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) continue;
    result[index] = sensitiveIndexes.has(index)
      ? CENSORED_LOG_VALUE
      : censorQueryParameter(value[index], seen);
  }

  return result;
};

export const censorDatabaseQueryParams = (
  query: string,
  params: readonly unknown[]
): readonly unknown[] =>
  censorQueryParamsInternal(query, params, new WeakMap()) as readonly unknown[];

const censorLogRecordValue = <T>(
  key: string,
  value: T,
  seen: WeakMap<object, unknown>,
  databaseQuery?: string,
  stackMessage?: string
): unknown => {
  if (
    ["exception.stacktrace", "stack", "stacktrace"].includes(key.toLowerCase())
  ) {
    if (!(Predicate.isString(value) && stackMessage !== undefined)) {
      return CENSORED_LOG_VALUE;
    }
    return censorStackTrace(value, stackMessage);
  }
  if (isSensitiveLogRecordKey(key)) return CENSORED_LOG_VALUE;
  if (key.toLowerCase() === "cause") {
    return censorErrorCauseInternal(value, seen);
  }
  if (key.toLowerCase() === "params") {
    return censorQueryParamsInternal(databaseQuery, value, seen);
  }
  return censorLogValueInternal(value, seen);
};

const censorLogValueInternal = <T>(
  value: T,
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
        Predicate.isString(key)
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

  if (Predicate.isString(value)) return censorUrlString(value);

  if (Cause.isCause(value)) return censorCauseInternal(value, seen);

  if (isEffectDrizzleQueryError(value)) {
    const existing = seen.get(value);
    if (existing) return existing;

    const result: MutableLogAnnotations = {
      _tag: value._tag,
      query: value.query,
    };
    seen.set(value, result);
    result.params = censorQueryParamsInternal(value.query, value.params, seen);
    result.cause = censorErrorCauseInternal(value.cause, seen);
    return result;
  }

  if (isNativeError(value)) {
    const existing = seen.get(value);
    if (existing) return existing;

    const result: MutableLogAnnotations = {
      errorType: value.name,
      message: CENSORED_LOG_VALUE,
    };
    seen.set(value, result);

    for (const key of [
      "_tag",
      "reason",
      "operation",
      "code",
      "outcome",
      "failureCode",
      "errorCode",
      "status",
      "statusCode",
      "constraint",
    ] as const) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (property && "value" in property) {
        result[key] = censorLogRecordValue(key, property.value, seen);
      }
    }

    const stack = Object.getOwnPropertyDescriptor(value, "stack");
    if (stack && "value" in stack && Predicate.isString(stack.value)) {
      result.stack = censorStackTrace(stack.value, value.message);
    }

    if ("cause" in value) {
      result.cause = censorErrorCauseInternal(value.cause, seen);
    }

    const errors = Object.getOwnPropertyDescriptor(value, "errors");
    if (errors && "value" in errors && Array.isArray(errors.value)) {
      result.errors = errors.value.map((error) =>
        isStructuredErrorCause(error)
          ? censorLogValueInternal(error, seen)
          : CENSORED_LOG_VALUE
      );
    }

    return result;
  }

  if (!isPlainObject(value)) return value;

  const existing = seen.get(value);
  if (existing) return existing;

  const result: MutableLogAnnotations = {};
  seen.set(value, result);
  const databaseQuery = Predicate.isString(value.query)
    ? value.query
    : undefined;
  let stackMessage: string | undefined;
  if (Predicate.isString(value["exception.message"])) {
    stackMessage = value["exception.message"];
  } else if (Predicate.isString(value.message)) {
    stackMessage = value.message;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = censorLogRecordValue(
      key,
      nestedValue,
      seen,
      databaseQuery,
      stackMessage
    );
  }

  return result;
};

export const censorTelemetryValue = <T>(value: T): unknown =>
  censorLogValueInternal(value, new WeakMap());

export const censorLogValue = censorTelemetryValue;

function censorErrorCauseInternal(
  cause: unknown,
  seen: WeakMap<object, unknown>
): unknown {
  return isStructuredErrorCause(cause) || isPlainObject(cause)
    ? censorLogValueInternal(cause, seen)
    : CENSORED_LOG_VALUE;
}

const isStructuredErrorCause = (cause: unknown): boolean =>
  Cause.isCause(cause) ||
  isEffectDrizzleQueryError(cause) ||
  isNativeError(cause);

const censorCauseInternal = (
  cause: Cause.Cause<unknown>,
  seen: WeakMap<object, unknown>
): Cause.Cause<unknown> => {
  const existing = seen.get(cause);
  if (Cause.isCause(existing)) return existing;

  const result = Cause.fromReasons(
    cause.reasons.map((reason) => {
      if (Cause.isFailReason(reason)) {
        return Cause.makeFailReason(
          censorErrorCauseInternal(reason.error, seen)
        );
      }
      if (Cause.isDieReason(reason)) {
        return Cause.makeDieReason(
          censorErrorCauseInternal(reason.defect, seen)
        );
      }
      return reason;
    })
  );
  seen.set(cause, result);
  return result;
};

const censorCause = (cause: Cause.Cause<unknown>): Cause.Cause<unknown> =>
  censorCauseInternal(cause, new WeakMap());

export const censorLoggerOptions = (
  options: Logger.Options<unknown>
): Logger.Options<unknown> => {
  const fiber = options.fiber;

  return {
    ...options,
    cause: censorCause(options.cause),
    message: censorLogValue(options.message),
    fiber: {
      ...fiber,
      getRef: (ref) => {
        const value = fiber.getRef(ref);
        if (ref !== References.CurrentLogAnnotations) return value;
        const annotations = value as LogAnnotations;

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

const toOtelValue = <T>(value: T): AnyValue => {
  if (
    Predicate.isString(value) ||
    Predicate.isNumber(value) ||
    Predicate.isBoolean(value)
  ) {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const toOtelBody = <T>(message: T): AnyValue => {
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
