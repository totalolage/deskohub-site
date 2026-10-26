import { Predicate } from "effect";

export const CENSORED_LOG_VALUE = "[REDACTED]";

/**
 * Error properties that classify a failure without describing its payload.
 * Logs keep their values only after `censorErrorClassificationValue`.
 */
export const errorClassificationKeys = [
  "_tag",
  "reason",
  "operation",
  "code",
  "outcome",
  "failureCode",
  "errorCode",
  "status",
  "statusCode",
  "httpStatus",
  "request",
  "constraint",
] as const;

/**
 * Keeps finite numbers, booleans, and short identifier-like strings such as
 * tags, codes, and statuses; censors every other value.
 */
export const censorErrorClassificationValue = <T>(value: T): T | string => {
  if (Predicate.isBoolean(value)) return value;
  if (Predicate.isNumber(value)) {
    return Number.isFinite(value) ? value : CENSORED_LOG_VALUE;
  }
  if (
    Predicate.isString(value) &&
    value.length <= 64 &&
    /^(?:[A-Za-z][A-Za-z0-9]*(?:[._:/-][A-Za-z0-9]+)*|[0-9A-Z]{5})$/.test(value)
  ) {
    return value;
  }
  return CENSORED_LOG_VALUE;
};

// Built-in JavaScript and DOM error names. Any code can set an error's `name`
// or `_tag`, so only these fixed values are trusted to carry no caller data.
const trustedErrorTypes = new Set([
  "AbortError",
  "AggregateError",
  "DataCloneError",
  "DataError",
  "Error",
  "EvalError",
  "InvalidStateError",
  "NetworkError",
  "NotAllowedError",
  "NotFoundError",
  "NotSupportedError",
  "OperationError",
  "QuotaExceededError",
  "RangeError",
  "ReferenceError",
  "SecurityError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError",
]);

/**
 * The error's `_tag`, or else its `name`, when that is a built-in JavaScript
 * or DOM error name; `"unclassified"` for every other value.
 */
export const classifyErrorType = <T>(error: T): string => {
  let type: unknown;
  if (Predicate.hasProperty(error, "_tag")) type = error._tag;
  else if (Predicate.hasProperty(error, "name")) type = error.name;

  return Predicate.isString(type) && trustedErrorTypes.has(type)
    ? type
    : "unclassified";
};
