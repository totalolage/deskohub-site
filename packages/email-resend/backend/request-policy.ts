import { ProviderRetryPolicy } from "@deskohub/provider-request";

/**
 * A single Resend send retries a transport or server failure under its
 * idempotency key, with a jittered exponential backoff from 1 second, at most
 * three times. A batch send runs once; only its caller can replay it safely.
 */
export const resendRetryPolicy = ProviderRetryPolicy.make({
  label: "Email",
  baseDelay: "1 second",
  maxRetries: 3,
});
