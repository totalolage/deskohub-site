import { Schedule } from "effect";
import { HttpClient, type HttpClientError } from "effect/unstable/http";

/**
 * A request may be sent again only when it never got an answer: a transport
 * failure on a GET. Answers, 429 and other 4xx included, are the server's
 * word and are never retried, and writes are never sent twice.
 */
export const isRetryableRead = (error: HttpClientError.HttpClientError) =>
  error.reason._tag === "TransportError" && error.request.method === "GET";

/** One more attempt at most, after a short pause. */
export const readRetryPolicy = {
  schedule: Schedule.exponential("300 millis"),
  times: 1,
} as const;

/** The customer API clients' retry policy for transient read failures. */
export const retryTransientReads = (
  client: HttpClient.HttpClient
): HttpClient.HttpClient =>
  HttpClient.retry(client, { ...readRetryPolicy, while: isRetryableRead });
