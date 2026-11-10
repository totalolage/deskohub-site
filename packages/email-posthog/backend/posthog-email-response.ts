import { Clock, Duration, Effect, Option, Schema } from "effect";
import type { HttpClientResponse } from "effect/unstable/http";

/** PostHog error codes are lowercase words joined by underscores. */
const postHogCodePattern = /^[a-z][a-z0-9_]{0,63}$/;

const ErrorAnswerSchema = Schema.Struct({ code: Schema.String });

/**
 * The machine code of a PostHog error answer, never its `detail` text: a code
 * outside PostHog's vocabulary becomes `unrecognized`, and an answer without a
 * readable code becomes `http_<status>`.
 */
export const postHogFailureCode = (
  response: HttpClientResponse.HttpClientResponse
) =>
  response.text.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.fromJsonString(ErrorAnswerSchema))
    ),
    Effect.map(({ code }) =>
      postHogCodePattern.test(code) ? code : "unrecognized"
    ),
    Effect.orElseSucceed(() => `http_${response.status}`)
  );

/**
 * The wait an answer's `Retry-After` header asks for, in seconds or as an HTTP
 * date, or `undefined` without a readable one.
 */
export const readRetryAfter = (
  response: HttpClientResponse.HttpClientResponse
) =>
  Effect.map(Clock.currentTimeMillis, (now) =>
    Option.fromNullishOr(response.headers["retry-after"]).pipe(
      Option.flatMap((value) => parseRetryAfter(value.trim(), now)),
      Option.getOrUndefined
    )
  );

const parseRetryAfter = (value: string, now: number) => {
  if (/^\d+$/.test(value)) {
    return Option.some(Duration.seconds(Number(value)));
  }
  const date = Date.parse(value);
  return Number.isNaN(date)
    ? Option.none()
    : Option.some(Duration.millis(Math.max(0, date - now)));
};
