import { Effect, Predicate, Record } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { postHogEmailDeliveries } from "@/db/schema";
import type {
  EmailDeliveryObserver,
  EmailSentEvent,
} from "./email-delivery-observer";

/**
 * The tags a delivery report about the email carries: every string metadata
 * entry plus its category, as the Resend provider tags a message, without
 * Resend's limits on tag characters.
 */
const deliveryReportTags = ({
  category,
  metadata,
}: EmailSentEvent): Readonly<Record<string, string>> => ({
  ...Record.filter(metadata ?? {}, Predicate.isString),
  ...(category !== undefined && { category }),
});

/** The provider name the email service reports PostHog's sends under. */
const postHogProvider = "posthog";

/**
 * Records each email PostHog accepts, so its status can be polled: PostHog
 * has no delivery-report webhook. Recording never fails the send; a delivery
 * it could not record is logged and gets no delivery report.
 */
export const makePostHogDeliveryTrackingObserver: Effect.Effect<
  EmailDeliveryObserver,
  never,
  WorkspaceDatabase
> = Effect.map(WorkspaceDatabase, ({ db, transaction }) => ({
  onSent: (event) => {
    if (event.provider !== postHogProvider) return Effect.void;
    const sentAt = Temporal.Instant.fromEpochMilliseconds(event.at.getTime());
    const record = db
      .insert(postHogEmailDeliveries)
      .values({
        messageId: event.deliveryId,
        category: event.category ?? null,
        tags: deliveryReportTags(event),
        sentAt,
        nextPollAt: sentAt,
      })
      .onConflictDoNothing();
    // Inside a caller's transaction this is a savepoint, so a failed insert
    // doesn't abort the caller's transaction after the failure is swallowed.
    return transaction(record).pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning(
          "PostHog email delivery could not be recorded; its status will not be polled",
          { cause, deliveryId: event.deliveryId, category: event.category }
        )
      )
    );
  },
  onFallback: () => Effect.void,
}));
