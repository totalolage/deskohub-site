import { ProviderRetryPolicy } from "@deskohub/provider-request";
import type { Duration } from "effect";

/**
 * Nexi reads retry transient failures with a jittered exponential backoff
 * from 100 ms, at most three times. Hosted payment page creation has no
 * idempotency key, so it runs once.
 */
export const nexiRetryPolicy = ProviderRetryPolicy.make({
  label: "Nexi",
  baseDelay: "100 millis",
  maxRetries: 3,
});

/** The Nexi request policy of a deployment's per-attempt timeout. */
export const getNexiRequestPolicy = (apiTimeout: Duration.Input) =>
  nexiRetryPolicy.withAttemptTimeout(apiTimeout);

/**
 * The longest a retried Nexi request without its own deadline can take when
 * every attempt times out: the first attempt and each retry wait up to
 * `apiTimeout`, with the jittered exponential backoff between them.
 */
export const getNexiRequestWorstCaseDuration = (apiTimeout: Duration.Input) =>
  getNexiRequestPolicy(apiTimeout).worstCase.retried;
