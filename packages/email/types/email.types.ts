/**
 * Email Service Types
 *
 * Core types for the email service that are provider-agnostic
 */

import { Schema } from "effect";

export const EmailDeliveryIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("EmailDeliveryId")
).annotate({
  identifier: "EmailDeliveryId",
  description:
    "Opaque identifier for an email delivery accepted by a provider.",
});
export type EmailDeliveryId = typeof EmailDeliveryIdSchema.Type;

/**
 * Email recipient type
 */
export interface EmailRecipient {
  email: string;
  name?: string;
}

/**
 * Email attachment type
 */
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  contentId?: string;
  encoding?: string;
}

/**
 * Core email message structure
 */
export interface EmailMessage {
  from: EmailRecipient;
  to: EmailRecipient | EmailRecipient[];
  cc?: EmailRecipient | EmailRecipient[];
  bcc?: EmailRecipient | EmailRecipient[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: EmailRecipient;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** Providers suppress recipient and content when this message may carry secrets. */
  sensitiveContent?: boolean;
}

/**
 * Email send result
 */
export interface EmailSendResult {
  id: EmailDeliveryId;
  status: "sent" | "queued" | "failed";
  provider: string;
  timestamp: Date;
  error?: string;
}

/**
 * Email delivery configuration. `EmailServiceTag.RecipientRouted` sends mail
 * for `EMAIL_TEST_DOMAIN` recipients to Console and everything else to Resend
 * with `apiKey`, or everything to Console when `apiKey` is missing;
 * `EmailServiceTag.Live` instead selects one provider from `provider` and
 * `testMode`.
 */
export interface EmailConfig {
  provider?: "resend" | "console";
  apiKey?: string;
  defaultFrom: EmailRecipient;
  testMode?: boolean;
}

/**
 * Email provider configuration
 */
export interface EmailProviderConfig extends EmailConfig {
  provider: "resend" | "console";
}
