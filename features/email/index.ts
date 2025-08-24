/**
 * Email Feature Public API
 *
 * Exports the public interface for the email feature
 */

// Provider factory for custom provider configuration
export {
  createEmailProviderLayer,
  type EmailProviderType,
} from "./backend/provider-factory";
// Individual providers (for testing or explicit configuration)
export { ConsoleEmailProviderLive } from "./backend/providers/console-provider";
export { ResendEmailProviderLive } from "./backend/providers/resend-provider";
// Direct email sending functions (used by webhooks)
export {
  sendReservationConfirmedEmail,
  sendReservationCreatedEmail,
  sendReservationDeclinedEmail,
} from "./backend/send-reservation-status-email";
// Services and Tags (only what's actually used externally)
export { EmailConfigTag, EmailServiceError } from "./backend/service";
// Standalone Email Service
export { StandaloneEmailServiceLive } from "./backend/standalone-email-service";

// Types
export type {
  EmailMessage,
  EmailProviderConfig,
  EmailRecipient,
  EmailSendResult,
  EmailTemplateData,
  EmailTemplateType,
  ReservationConfirmationData,
} from "./types/email.types";
