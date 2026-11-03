import { ProviderRetryPolicy } from "@deskohub/provider-request";

/**
 * A single email send retries a transport failure under its idempotency key,
 * with a jittered exponential backoff from 1 second, at most three times. A
 * batch send runs once; only its caller can replay it safely.
 */
export const emailRetryPolicy = ProviderRetryPolicy.make({
  label: "Email",
  baseDelay: "1 second",
  maxRetries: 3,
});
