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
  Result,
} from "effect";
import {
  CENSORED_LOG_VALUE,
  censorErrorClassificationValue,
  errorClassificationKeys,
} from "@/shared/utils/log-classification";
import { getSensitiveDatabaseQueryParameterIndexes } from "./database-query-parameter-classifier";

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
  "requesteddiscountcode",
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

const censorAbsoluteUrl = (url: URL, value: string) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") return value;

  redactUrlSearchParams(url);
  return url.toString();
};

// Writes a censored relative URL back in the form it was logged in:
// protocol-relative, query-only, path-relative or bare.
const formatRelativeUrl = (url: URL, value: string) => {
  const searchAndHash = `${url.search}${url.hash}`;
  if (value.startsWith("//")) {
    return `//${url.host}${url.pathname}${searchAndHash}`;
  }
  if (value.startsWith("?")) return searchAndHash;
  if (value.startsWith("/")) return `${url.pathname}${searchAndHash}`;
  return `${url.pathname.slice(1)}${searchAndHash}`;
};

const censorRelativeUrl = (value: string) => {
  if (
    !(value.startsWith("/") || value.startsWith("?") || value.includes("?"))
  ) {
    return value;
  }

  const relativeUrl = URL.parse(value, "https://deskohub.local");
  if (!relativeUrl) return value;

  redactUrlSearchParams(relativeUrl);
  return formatRelativeUrl(relativeUrl, value);
};

const censorUrlString = (value: string) => {
  const absoluteUrl = URL.parse(value);
  return absoluteUrl
    ? censorAbsoluteUrl(absoluteUrl, value)
    : censorRelativeUrl(value);
};

const censorStackFrameSource = (source: string): string | undefined => {
  const location = source.replace(/[?#].*$/, "");
  if (/^(?:\/(?!\/)|[A-Za-z]:[\\/])/.test(location)) return location;

  const isProtocolRelative = location.startsWith("//");
  const url = isProtocolRelative
    ? URL.parse(location, "https://deskohub.local")
    : URL.parse(location);
  if (!url) return undefined;

  url.username = "";
  url.password = "";
  return isProtocolRelative ? `//${url.host}${url.pathname}` : url.toString();
};

// Where a stack's frames start: right after the logged message, or after a
// first line with no message marker when the message is empty or frames
// follow. -1 when the stack's first line can't be matched to the message.
const findStackFramesStart = (stack: string, message: string): number => {
  const messageMarker = stack.indexOf(": ");
  if (messageMarker >= 0) {
    return stack.startsWith(message, messageMarker + 2)
      ? messageMarker + 2 + message.length
      : -1;
  }

  const firstLineEnd = stack.indexOf("\n");
  return message === "" ||
    (firstLineEnd >= 0 && /^[\t ]*at[\t ]/.test(stack.slice(firstLineEnd + 1)))
    ? firstLineEnd
    : -1;
};

// A stack frame line kept as its censored source location alone, or nothing
// for a frame without a known source.
const censorStackFrame = (line: string): readonly string[] => {
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
};

const censorStackTrace = (stack: string, message: string): string => {
  const framesStart = findStackFramesStart(stack, message);
  if (framesStart < 0 || stack[framesStart] !== "\n") {
    return CENSORED_LOG_VALUE;
  }

  const frames = stack
    .slice(framesStart + 1)
    .split("\n")
    .flatMap(censorStackFrame);

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

type LogValueCensorship = WeakMap<object, unknown>;

// Censors a value that holds other values one step at a time: it yields each
// held value and gets its censored form back, so deep nesting grows a heap
// stack in `runCensorSteps` rather than the call stack. Each object's steps
// register its result before yielding, so a shared or cyclic reference to it
// gets that same result and the censored value keeps its shape.
type CensorSteps = Generator<unknown, unknown, unknown>;

// An error's cause keeps its shape only as a structured error or a record.
function* censorErrorCause(cause: unknown): CensorSteps {
  return isStructuredErrorCause(cause) || isPlainObject(cause)
    ? yield cause
    : CENSORED_LOG_VALUE;
}

function* censorQueryParameter<T>(
  value: T,
  seen: LogValueCensorship
): CensorSteps {
  if (!Predicate.isString(value)) return yield value;

  return Result.try(() =>
    JSON.stringify(censorLogValueInternal(JSON.parse(value) as unknown, seen))
  ).pipe(Result.getOrElse(() => censorLogValueInternal(value, seen)));
}

function* censorQueryParams<T>(
  query: string | undefined,
  value: T,
  seen: LogValueCensorship
): CensorSteps {
  if (!Array.isArray(value)) return yield value;

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
      : yield* censorQueryParameter(value[index], seen);
  }

  return result;
}

export const censorDatabaseQueryParams = (
  query: string,
  params: readonly unknown[]
): readonly unknown[] => {
  const seen: LogValueCensorship = new WeakMap();
  return runCensorSteps(
    censorQueryParams(query, params, seen),
    seen
  ) as readonly unknown[];
};

const isStackTraceKey = (key: string) =>
  ["exception.stacktrace", "stack", "stacktrace"].includes(key.toLowerCase());

function* censorLogRecordValue<T>(
  key: string,
  value: T,
  seen: LogValueCensorship,
  databaseQuery?: string,
  stackMessage?: string
): CensorSteps {
  if (isStackTraceKey(key)) {
    return Predicate.isString(value) && stackMessage !== undefined
      ? censorStackTrace(value, stackMessage)
      : CENSORED_LOG_VALUE;
  }
  if (isSensitiveLogRecordKey(key)) return CENSORED_LOG_VALUE;
  if (key.toLowerCase() === "cause") return yield* censorErrorCause(value);
  if (key.toLowerCase() === "params") {
    return yield* censorQueryParams(databaseQuery, value, seen);
  }
  return yield value;
}

function* censorArray(
  value: readonly unknown[],
  seen: LogValueCensorship
): CensorSteps {
  const result: unknown[] = [];
  seen.set(value, result);

  for (let index = 0; index < value.length; index += 1) {
    if (index in value) result[index] = yield value[index];
  }

  return result;
}

function* censorMap(
  value: Map<unknown, unknown>,
  seen: LogValueCensorship
): CensorSteps {
  const result = new Map<unknown, unknown>();
  seen.set(value, result);

  for (const [key, nestedValue] of value) {
    result.set(
      key,
      Predicate.isString(key)
        ? yield* censorLogRecordValue(key, nestedValue, seen)
        : yield nestedValue
    );
  }

  return result;
}

// A header or search parameter value, censored whole under a sensitive key.
function* censorKeyedText(
  key: string,
  value: string
): Generator<unknown, string> {
  return isSensitiveLogRecordKey(key)
    ? CENSORED_LOG_VALUE
    : String(yield value);
}

function* censorHeaders(value: Headers, seen: LogValueCensorship): CensorSteps {
  const result = new Headers();
  seen.set(value, result);

  for (const [key, nestedValue] of value) {
    result.set(key, yield* censorKeyedText(key, nestedValue));
  }

  return result;
}

function* censorSearchParams(
  value: URLSearchParams,
  seen: LogValueCensorship
): CensorSteps {
  const result = new URLSearchParams();
  seen.set(value, result);

  for (const [key, nestedValue] of value) {
    result.append(key, yield* censorKeyedText(key, nestedValue));
  }

  return result;
}

// A failed query keeps no SQL text or parameter values at any log level: the
// "Database query" row logged before the attempt carries them wherever the
// Debug level is on (see `DatabaseQueryLoggerLive`).
function* censorDrizzleQueryError(
  value: EffectDrizzleQueryError,
  seen: LogValueCensorship
): CensorSteps {
  const result: MutableLogAnnotations = {
    _tag: value._tag,
    parameterCount: value.params.length,
  };
  seen.set(value, result);

  result.cause = yield* censorErrorCause(value.cause);
  return result;
}

// An error's own data property: an accessor could compute anything.
const findOwnDataProperty = (value: Error, key: string) => {
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property && "value" in property ? property : undefined;
};

const censorErrorClassification = (
  value: Error,
  result: MutableLogAnnotations
) => {
  for (const key of errorClassificationKeys) {
    const property = findOwnDataProperty(value, key);
    if (property) result[key] = censorErrorClassificationValue(property.value);
  }
};

// An aggregate error's errors, keeping only structured ones.
function* censorAggregatedErrors(errors: readonly unknown[]): CensorSteps {
  const length = errors.length;
  const result = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    if (!(index in errors)) continue;
    const error = errors[index];
    result[index] = isStructuredErrorCause(error)
      ? yield error
      : CENSORED_LOG_VALUE;
  }
  return result;
}

function* censorNativeError(
  value: Error,
  seen: LogValueCensorship
): CensorSteps {
  const result: MutableLogAnnotations = {
    // Any code can set `name`, so it passes the same filter as `_tag`.
    errorType: censorErrorClassificationValue(value.name),
    message: CENSORED_LOG_VALUE,
  };
  seen.set(value, result);
  censorErrorClassification(value, result);

  const stack = findOwnDataProperty(value, "stack");
  if (stack && Predicate.isString(stack.value)) {
    result.stack = censorStackTrace(stack.value, value.message);
  }

  if ("cause" in value) {
    result.cause = yield* censorErrorCause(value.cause);
  }

  const errors = findOwnDataProperty(value, "errors");
  if (errors && Array.isArray(errors.value)) {
    result.errors = yield* censorAggregatedErrors(errors.value);
  }

  return result;
}

// The message a record's stack trace starts with: its exception message, or
// else its message.
const findRecordStackMessage = (value: LogAnnotations) => {
  if (Predicate.isString(value["exception.message"])) {
    return value["exception.message"];
  }
  return Predicate.isString(value.message) ? value.message : undefined;
};

function* censorRecord(
  value: LogAnnotations,
  seen: LogValueCensorship
): CensorSteps {
  const result: MutableLogAnnotations = {};
  seen.set(value, result);
  const databaseQuery = Predicate.isString(value.query)
    ? value.query
    : undefined;
  const stackMessage = findRecordStackMessage(value);

  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = yield* censorLogRecordValue(
      key,
      nestedValue,
      seen,
      databaseQuery,
      stackMessage
    );
  }

  return result;
}

// The steps for an object not censored before; one censored before gets its
// earlier result without steps.
const startCensorSteps = <Input extends object>(
  value: Input,
  seen: LogValueCensorship,
  censor: (value: Input, seen: LogValueCensorship) => CensorSteps
): CensorSteps | undefined =>
  seen.has(value) ? undefined : censor(value, seen);

// The steps for an error or a record; a cause is censored without steps.
const findObjectCensorSteps = <T>(
  value: T,
  seen: LogValueCensorship
): CensorSteps | undefined => {
  if (Cause.isCause(value)) return undefined;
  if (isEffectDrizzleQueryError(value)) {
    return startCensorSteps(value, seen, censorDrizzleQueryError);
  }
  if (isNativeError(value)) {
    return startCensorSteps(value, seen, censorNativeError);
  }
  return isPlainObject(value)
    ? startCensorSteps(value, seen, censorRecord)
    : undefined;
};

// The steps that censor a value holding other values, or undefined for a
// value censored without steps.
const findCensorSteps = <T>(
  value: T,
  seen: LogValueCensorship
): CensorSteps | undefined => {
  if (Array.isArray(value)) return startCensorSteps(value, seen, censorArray);
  if (isMap(value)) return startCensorSteps(value, seen, censorMap);
  if (isHeaders(value)) return startCensorSteps(value, seen, censorHeaders);
  if (isURLSearchParams(value)) {
    return startCensorSteps(value, seen, censorSearchParams);
  }
  return findObjectCensorSteps(value, seen);
};

// An object censored before gets that same result, a string its censored URL
// and a cause its censored reasons; any other value is kept as it is.
const censorWithoutSteps = <T>(value: T, seen: LogValueCensorship): unknown => {
  if (Predicate.isString(value)) return censorUrlString(value);
  if (Predicate.isObjectOrArray(value) && seen.has(value)) {
    return seen.get(value);
  }
  return Cause.isCause(value) ? censorCauseInternal(value, seen) : value;
};

// Runs censor steps to completion, starting the steps of each value they
// yield and resuming them with its censored form.
const runCensorSteps = (
  steps: CensorSteps,
  seen: LogValueCensorship
): unknown => {
  const suspended: CensorSteps[] = [];
  let current: CensorSteps | undefined = steps;
  let censored: unknown;

  while (current) {
    const step = current.next(censored);
    if (step.done) {
      censored = step.value;
      current = suspended.pop();
      continue;
    }

    const nested = findCensorSteps(step.value, seen);
    if (nested) {
      suspended.push(current);
      current = nested;
    } else {
      censored = censorWithoutSteps(step.value, seen);
    }
  }

  return censored;
};

const censorLogValueInternal = <T>(
  value: T,
  seen: LogValueCensorship
): unknown => {
  const steps = findCensorSteps(value, seen);
  return steps ? runCensorSteps(steps, seen) : censorWithoutSteps(value, seen);
};

export const censorLogValue = <T>(value: T): unknown =>
  censorLogValueInternal(value, new WeakMap());

const isStructuredErrorCause = (cause: unknown): boolean =>
  Cause.isCause(cause) ||
  isEffectDrizzleQueryError(cause) ||
  isNativeError(cause);

const censorCauseInternal = (
  cause: Cause.Cause<unknown>,
  seen: LogValueCensorship
): Cause.Cause<unknown> => {
  const existing = seen.get(cause);
  if (Cause.isCause(existing)) return existing;

  // A loop rather than `map`, so each nested cause costs fewer stack frames.
  const reasons: Cause.Reason<unknown>[] = [];
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      reasons.push(
        Cause.makeFailReason(
          runCensorSteps(censorErrorCause(reason.error), seen)
        )
      );
    } else if (Cause.isDieReason(reason)) {
      // A defect can be any thrown value, so only a structured error keeps
      // its shape; a plain object could be a whole payload.
      reasons.push(
        Cause.makeDieReason(
          isStructuredErrorCause(reason.defect)
            ? censorLogValueInternal(reason.defect, seen)
            : CENSORED_LOG_VALUE
        )
      );
    } else {
      reasons.push(reason);
    }
  }
  const result = Cause.fromReasons(reasons);
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
          Object.entries(annotations).map(([key, nestedValue]) => {
            const seen: LogValueCensorship = new WeakMap();
            return [
              key,
              runCensorSteps(
                censorLogRecordValue(key, nestedValue, seen),
                seen
              ),
            ];
          })
        ) as typeof value;
      },
    },
  };
};

const CensoringFormatter = Logger.make((options) =>
  Logger.formatLogFmt.log(censorLoggerOptions(options))
);

const CensoringLogger = Logger.withLeveledConsole(CensoringFormatter);

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

  return Result.try(() => JSON.stringify(value)).pipe(
    Result.getOrElse(() => String(value))
  );
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
  attributes: censorLogValue(span.attributes) as ReadableSpan["attributes"],
  droppedAttributesCount: span.droppedAttributesCount,
  droppedEventsCount: span.droppedEventsCount,
  droppedLinksCount: span.droppedLinksCount,
  duration: span.duration,
  ended: span.ended,
  endTime: span.endTime,
  events: span.events.map((event) => {
    const attributes = censorLogValue(
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
    attributes: censorLogValue(link.attributes) as typeof link.attributes,
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
  const censored = censorLogValue(
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
