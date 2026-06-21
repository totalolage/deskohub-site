export { ConsoleEmailProviderLive } from "./backend/providers/console-provider";
export { EmailProviderLive } from "./backend/provider-factory";
export { ResendEmailProviderLive } from "./backend/providers/resend-provider";
export {
  EmailConfigTag,
  EmailServiceError,
  EmailServiceTag,
} from "./backend/service";
export { StandaloneEmailServiceLayer } from "./backend/standalone-email-service";

export type {
  EmailAttachment,
  EmailMessage,
  EmailProviderConfig,
  EmailRecipient,
  EmailSendResult,
  EmailTemplateData,
  EmailTemplateType,
  ReservationConfirmationData,
} from "./types/email.types";
