/**
 * Email Feature Public API
 *
 * Exports the public interface for the email feature
 */

// Direct email sending functions
export { sendReservationConfirmationEmail } from "./backend/send-reservation-email";

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
