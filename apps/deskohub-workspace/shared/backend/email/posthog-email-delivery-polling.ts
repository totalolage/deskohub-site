import "server-only";

import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";

/**
 * What asked for a poll: the PostHog webhook's signal that some email's
 * status changed, or the scheduled safety-net sweep.
 */
export type PostHogEmailDeliveryPollTrigger = "signal" | "schedule";

/** Why a poll stopped before reading every message it claimed. */
export type PostHogEmailDeliveryPollStop = "rate-limited" | "unauthorized";

/** The result of one poll of pending PostHog email deliveries. */
export type PostHogEmailDeliveryPollSummary =
  | { readonly outcome: "not-configured" }
  | {
      readonly outcome: "polled";
      readonly trigger: PostHogEmailDeliveryPollTrigger;
      /** Status reads made against PostHog. */
      readonly polled: number;
      /** Messages that reached a final status and were reported. */
      readonly settled: number;
      /** Messages given up on without a final status. */
      readonly expired: number;
      readonly stoppedBy?: PostHogEmailDeliveryPollStop;
    };

/**
 * Reads PostHog's status of pending PostHog email deliveries and reports
 * final statuses to the delivery-report handlers.
 */
export class PostHogEmailDeliveryPolling extends Context.Service<
  PostHogEmailDeliveryPolling,
  {
    readonly poll: (
      trigger: PostHogEmailDeliveryPollTrigger
    ) => Effect.Effect<
      PostHogEmailDeliveryPollSummary,
      EffectDrizzleQueryError
    >;
  }
>()("@deskohub/workspace/PostHogEmailDeliveryPolling") {
  // seam: replaced by the poller implementation (stream pheml-s4 part A).
  static Live: Layer.Layer<PostHogEmailDeliveryPolling> = Layer.succeed(this, {
    poll: () =>
      Effect.die("PostHogEmailDeliveryPolling is not implemented yet"),
  });
}
