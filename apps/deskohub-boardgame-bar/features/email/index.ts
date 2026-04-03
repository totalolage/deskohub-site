/**
 * Email Feature Public API
 *
 * Exports the public interface for the email feature
 */

// Provider factory for custom provider configuration
export {
  createEmailProviderLayer,
  type EmailProviderType,
} from "@deskohub/email/backend/provider-factory";
// Individual providers (for testing or explicit configuration)
export { ConsoleEmailProviderLive } from "@deskohub/email/backend/providers/console-provider";
export { ResendEmailProviderLive } from "@deskohub/email/backend/providers/resend-provider";
// Services and Tags (only what's actually used externally)
export {
  EmailConfigTag,
  EmailServiceError,
} from "@deskohub/email/backend/service";
// Types
export type {
  EmailMessage,
  EmailProviderConfig,
  EmailRecipient,
  EmailSendResult,
  EmailTemplateData,
  EmailTemplateType,
  ReservationConfirmationData,
} from "@deskohub/email/types/email.types";
// Direct email sending functions (used by webhooks)
export { sendNewReservationNotification } from "./backend/send-reservation-notification";
export {
  sendReservationConfirmedEmail,
  sendReservationCreatedEmail,
  sendReservationDeclinedEmail,
} from "./backend/send-reservation-status-email";
