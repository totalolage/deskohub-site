// seam: EmailSentEvent from @deskohub/email
import type { EmailDeliveryId, EmailMessage } from "@deskohub/email";
import type { Effect } from "effect";

/** An email a provider accepted for delivery. */
export interface EmailSentEvent {
  readonly provider: string;
  readonly deliveryId: EmailDeliveryId;
  readonly stream: "transactional" | "marketing";
  readonly category: string | undefined;
  /** The message's categories; `tags[0]` is its category. */
  readonly tags: readonly string[];
  readonly metadata:
    | Readonly<NonNullable<EmailMessage["metadata"]>>
    | undefined;
  readonly idempotencyKey: string | undefined;
  readonly at: Date;
}

/** Hears about every email the email service hands to a provider. */
export interface EmailDeliveryObserver {
  readonly onSent: (event: EmailSentEvent) => Effect.Effect<void>;
  readonly onFallback: (event: EmailSentEvent) => Effect.Effect<void>;
}
