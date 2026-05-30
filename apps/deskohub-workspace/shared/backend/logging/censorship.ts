import { Effect, HashMap, Logger } from "effect";

export const CENSORED_LOG_VALUE = "[REDACTED]";

const sensitiveLogKeyFragments = [
  "password",
  "passwd",
  "pwd",
  "token",
  "access token",
  "refresh token",
  "id token",
  "secret",
  "client secret",
  "api key",
  "authorization",
  "auth",
  "cookie",
  "set cookie",
  "session",
] as const;

const sensitiveLogUrlSearchParams = new Set([
  "checkouttoken",
  "x-vercel-protection-bypass",
  "token",
  "state",
  "secret",
]);

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

const censorUrlString = (value: string) => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return value;

  for (const key of Array.from(url.searchParams.keys())) {
    if (
      isSensitiveLogKey(key) ||
      sensitiveLogUrlSearchParams.has(key.toLowerCase())
    ) {
      url.searchParams.set(key, CENSORED_LOG_VALUE);
    }
  }

  return url.toString();
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
        typeof key === "string" && isSensitiveLogKey(key)
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
        isSensitiveLogKey(key)
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
        isSensitiveLogKey(key)
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
    result[key] = isSensitiveLogKey(key)
      ? CENSORED_LOG_VALUE
      : censorLogValueInternal(nestedValue, seen);
  }

  return result;
};

export const censorLogValue = (value: unknown): unknown =>
  censorLogValueInternal(value, new WeakMap());

export const censorLoggerOptions = (
  options: Logger.Logger.Options<unknown>
): Logger.Logger.Options<unknown> => ({
  ...options,
  message: censorLogValue(options.message),
  annotations: HashMap.reduce(
    options.annotations,
    HashMap.empty<string, unknown>(),
    (accumulator, value, key) =>
      HashMap.set(
        accumulator,
        key,
        isSensitiveLogKey(key) ? CENSORED_LOG_VALUE : censorLogValue(value)
      )
  ),
});

export const CensoringLogger = Logger.defaultLogger.pipe(
  Logger.mapInputOptions(censorLoggerOptions)
);

export const LoggerLive = Logger.replace(Logger.defaultLogger, CensoringLogger);

export const runWorkspaceEffect = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect.pipe(Effect.provide(LoggerLive)));
