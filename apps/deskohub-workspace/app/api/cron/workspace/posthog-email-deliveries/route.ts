import { Effect } from "effect";
import { PostHogEmailDeliveryPolling } from "@/shared/backend/email/posthog-email-delivery-polling";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

export const maxDuration = 300;

/**
 * The safety net for PostHog email statuses: polls the deliveries whose next
 * status read is due, whether or not PostHog's webhook signalled a change.
 */
export const GET = defineWorkspaceCron({
  operation: "postHogEmailDeliveryPollCron",
  failureMessage: "PostHog email delivery polling failed",
  run: () =>
    Effect.flatMap(PostHogEmailDeliveryPolling, (polling) =>
      polling.poll("schedule")
    ).pipe(Effect.provide(PostHogEmailDeliveryPolling.Live)),
});
