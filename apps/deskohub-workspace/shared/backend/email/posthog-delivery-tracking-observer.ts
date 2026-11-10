import type { EmailDeliveryObserver } from "@deskohub/email";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { postHogEmailDeliveries } from "@/db/schema";
import { type EmailKind, emailDeliveryReportTags } from "./email-kind";

/** The provider name the email service reports PostHog's sends under. */
const postHogProvider = "posthog";

/**
 * Records each email PostHog accepts, so its status can be polled: PostHog
 * has no delivery-report webhook. Each record keeps only the tags a delivery
 * report needs, by the email's kind among `kinds`. Recording never fails the
 * send; a delivery it could not record is logged and gets no delivery report.
 */
export const makePostHogDeliveryTrackingObserver = (
  kinds: readonly EmailKind<unknown>[]
): Effect.Effect<EmailDeliveryObserver, never, WorkspaceDatabase> =>
  Effect.map(WorkspaceDatabase, ({ db, transaction }) => ({
    onSent: (event) => {
      if (event.provider !== postHogProvider) return Effect.void;
      // Suspended, so an invalid send time is caught and logged with the rest.
      const record = Effect.suspend(() => {
        const sentAt = Temporal.Instant.fromEpochMilliseconds(
          event.at.getTime()
        );
        return db
          .insert(postHogEmailDeliveries)
          .values({
            messageId: event.deliveryId,
            category: event.category ?? null,
            tags: emailDeliveryReportTags(kinds, event),
            sentAt,
            nextPollAt: sentAt,
          })
          .onConflictDoNothing();
      });
      // Inside a caller's transaction this is a savepoint, so a failed insert
      // doesn't abort the caller's transaction after the failure is swallowed.
      // Its row then commits or rolls back with the caller's transaction.
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
