import type { EmailDeliveryId } from "@deskohub/email";
import type { PostHogEmailStatus } from "@deskohub/email-posthog";
import {
  type DeliveryReportEvent,
  deliveryReportEmailId,
  deliveryReportEventId,
  type ProviderDeliveryReport,
} from "./delivery-reports";

const finalStatuses = [
  "delivered",
  "failed",
  "bounced",
  "complained",
] as const satisfies readonly PostHogEmailStatus[];

/** A status PostHog no longer changes, which a delivery report carries. */
export type PostHogEmailFinalStatus = (typeof finalStatuses)[number];

export const isPostHogEmailFinalStatus = (
  status: PostHogEmailStatus
): status is PostHogEmailFinalStatus =>
  (finalStatuses as readonly PostHogEmailStatus[]).includes(status);

/**
 * The delivery report of PostHog's final status of one tracked email. Its
 * event ID is stable per message and status, so every read of the same
 * status reports the same event.
 */
export const postHogDeliveryReport = (input: {
  readonly messageId: EmailDeliveryId;
  readonly status: PostHogEmailFinalStatus;
  /** PostHog's time of the status; none when PostHog gave none. */
  readonly statusAt: Temporal.Instant | null;
  /** The email's tags as tracked when it was sent. */
  readonly tags: Readonly<Record<string, string>>;
  readonly polledAt: Temporal.Instant;
  /** This deployment's environment. */
  readonly deploymentEnvironment: string;
}): ProviderDeliveryReport => {
  const event: DeliveryReportEvent = `email.${input.status}`;
  return {
    eventId: deliveryReportEventId(
      `posthog:${input.messageId}:${input.status}`
    ),
    event,
    emailId: deliveryReportEmailId(input.messageId),
    occurredAt: input.statusAt ?? input.polledAt,
    tags: new Map(Object.entries(input.tags)),
    deploymentEnvironment: input.deploymentEnvironment,
  };
};
