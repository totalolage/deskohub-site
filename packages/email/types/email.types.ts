/**
 * Email Service Types
 *
 * Core types for the email service that are provider-agnostic
 */

import { Schema } from "effect";
import type { EmailSendError } from "../backend/capabilities";

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
  /**
   * An opaque identity of the recipient that a provider may attribute
   * engagement to, such as an analytics person id. Never an email address.
   */
  recipientIdentity?: string;
}

/** A message a provider accepted for delivery. */
export interface EmailSendResult {
  id: EmailDeliveryId;
  status: "sent" | "queued";
  provider: string;
  timestamp: Date;
}

/**
 * A message of a batch that no provider accepted. `error` is the last
 * provider's failure: a `NetworkError` leaves the outcome unknown, an
 * `EmailServiceError` means that provider sent nothing.
 */
export interface EmailSendFailure {
  status: "failed";
  provider: string;
  timestamp: Date;
  error: EmailSendError;
}

/** One message's outcome in a batch, in the batch's message order. */
export type EmailBatchResult = EmailSendResult | EmailSendFailure;

/**
 * Email delivery configuration. The email service reads only `defaultFrom`;
 * `provider`, `apiKey`, and `testMode` are inputs an app reads when it
 * composes its `EmailProviders` chains.
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
