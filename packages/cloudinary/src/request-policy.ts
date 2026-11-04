import { ProviderRetryPolicy } from "@deskohub/provider-request";

/**
 * A Cloudinary operation retries a transient failure, a 5xx-style HTTP code,
 * with a jittered exponential backoff from 100 ms, at most twice. 4xx failures
 * and errors without an HTTP code are definitive for the caller.
 */
export const getCloudinaryRetryPolicy = (operation: string) =>
  ProviderRetryPolicy.make({
    label: `Cloudinary ${operation}`,
    baseDelay: "100 millis",
    maxRetries: 2,
  });

export const isTransientCloudinaryFailure = (failure: {
  readonly httpCode?: number | undefined;
}) => failure.httpCode !== undefined && failure.httpCode >= 500;

/** Retries the operation's transient failures under its retry policy. */
export const retryTransientCloudinaryFailure = (operation: string) =>
  getCloudinaryRetryPolicy(operation).retryWhile(isTransientCloudinaryFailure);
