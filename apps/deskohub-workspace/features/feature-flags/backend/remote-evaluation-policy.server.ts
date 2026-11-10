import "server-only";

/**
 * Whether this deployment may ask PostHog to evaluate feature flags over the
 * network. Under `disabled`, a flag that is neither constant nor overridden
 * stays closed and nothing calls PostHog's `/flags` endpoint.
 */
export type RemoteEvaluationPolicy = "allowed" | "disabled";

/** The deployment's remote-evaluation policy. Every deployment allows it. */
export const readRemoteEvaluationPolicy = (): RemoteEvaluationPolicy =>
  "allowed";
