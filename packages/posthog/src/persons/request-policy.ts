import { ProviderRetryPolicy } from "@deskohub/provider-request";
import type { Duration } from "effect";
import type { PostHogPersonsRequest } from "./errors";

/**
 * The retry ceiling of every request the persons port sends. Package-private.
 *
 * A bulk delete has no idempotency key, so it retries only failures that prove
 * nothing was applied (a 429, or deletion errors naming a step before the
 * person was deleted), with a jittered exponential backoff from 1 second.
 */
export const postHogPersonsRequestCeilings = {
  "persons.bulkDelete": { baseDelay: "1 second", maxRetries: 2 },
} as const satisfies Record<
  PostHogPersonsRequest,
  { readonly baseDelay: Duration.Input; readonly maxRetries: number }
>;

/** The request policy of one persons request under a deployment's per-attempt timeout. */
export const getPostHogPersonsRequestPolicy = (
  request: PostHogPersonsRequest,
  attemptTimeout: Duration.Input
) =>
  ProviderRetryPolicy.make({
    label: `PostHog ${request}`,
    ...postHogPersonsRequestCeilings[request],
  }).withAttemptTimeout(attemptTimeout);
