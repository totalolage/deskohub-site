/**
 * Email Service Types
 *
 * Core types for the email service that are provider-agnostic
 */

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
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Email send result
 */
export interface EmailSendResult {
  id: string;
  status: "sent" | "queued" | "failed";
  provider: string;
  timestamp: Date;
  error?: string;
}

/**
 * Email template data types for different email types
 */
export interface ReservationConfirmationData {
  customerName: string;
  reservationId: string;
  datetime: Date;
  duration: number;
  guestCount: number;
  specialRequests?: string;
  tableName?: string;
  confirmationUrl?: URL;
  cancelUrl?: string;
  reservationUrl?: URL;
}

/**
 * Supported email template types
 */
export type EmailTemplateType = "reservation-confirmation";

/**
 * Template data union type
 */
export type EmailTemplateData = {
  type: "reservation-confirmation";
  data: ReservationConfirmationData;
};

/**
 * Email provider configuration
 */
export interface EmailProviderConfig {
  provider: "resend" | "smtp" | "sendgrid" | "mailgun" | "console";
  apiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  defaultFrom: EmailRecipient;
  testMode?: boolean;
}
