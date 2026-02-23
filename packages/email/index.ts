export {
  createEmailProviderLayer,
  type EmailProviderType,
} from "./backend/provider-factory";
export { ConsoleEmailProviderLive } from "./backend/providers/console-provider";
export { ResendEmailProviderLive } from "./backend/providers/resend-provider";
export {
  EmailConfigTag,
  EmailServiceError,
  EmailServiceTag,
} from "./backend/service";
export { createStandaloneEmailServiceLayer } from "./backend/standalone-email-service";

export type {
  EmailMessage,
  EmailProviderConfig,
  EmailRecipient,
  EmailSendResult,
  EmailTemplateData,
  EmailTemplateType,
  ReservationConfirmationData,
} from "./types/email.types";
