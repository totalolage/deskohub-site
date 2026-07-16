import {
  type AnyValue,
  type AnyValueMap,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import { Effect, Logger, type LogLevel, References } from "effect";
import { after } from "next/server";
import {
  getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
} from "./posthog-log-annotations";
import {
  postHogLoggerProvider,
  schedulePostHogLogsFlush,
} from "./posthog-otel";

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
] as const;

const sensitiveLogExactKeys = new Set(["x-vercel-sc-headers"]);

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
        typeof key === "string" && isSensitiveLogRecordKey(key)
          ? CENSORED_LOG_VALUE
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

  if (!isPlainObject(value)) return value;

  const existing = seen.get(value);
  if (existing) return existing;

  const result: Record<string, unknown> = {};
  seen.set(value, result);

  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = isSensitiveLogRecordKey(key)
      ? CENSORED_LOG_VALUE
      : censorLogValueInternal(nestedValue, seen);
  }

  return result;
};

export const censorLogValue = (value: unknown): unknown =>
  censorLogValueInternal(value, new WeakMap());

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
            isSensitiveLogKey(key)
              ? CENSORED_LOG_VALUE
              : censorLogValue(nestedValue),
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
    return JSON.stringify(value);
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

export const createWorkspaceLoggerLive = (loggerProvider?: LoggerProvider) =>
  Logger.layer(
    loggerProvider
      ? [CensoringLogger, createCensoredOtelLogger(loggerProvider)]
      : [CensoringLogger]
  );

export const LoggerLive = createWorkspaceLoggerLive(postHogLoggerProvider);

export const runWorkspaceEffectWithLogAnnotations = <A, E>(
  effect: Effect.Effect<A, E, never>,
  annotations: Record<string, unknown>
) =>
  Effect.runPromise(
    effect.pipe(Effect.annotateLogs(annotations), Effect.provide(LoggerLive))
  );

export const runWorkspaceEffect = <A, E>(effect: Effect.Effect<A, E, never>) =>
  runWorkspaceEffectWithLogAnnotations(effect, {});

export const runWorkspaceRequestEffect = <A, E>(
  request: Request,
  effect: Effect.Effect<A, E, never>
) => {
  schedulePostHogLogsFlush(after);
  const { annotations, unexpectedConsentCookieReasons } =
    getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics(request.headers);

  return runWorkspaceEffectWithLogAnnotations(
    Effect.gen(function* () {
      yield* logUnexpectedConsentCookieReasons(unexpectedConsentCookieReasons);
      return yield* effect;
    }),
    annotations
  );
};
