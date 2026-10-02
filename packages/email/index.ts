export type { EmailProvider } from "./backend/capabilities";
export { NetworkError } from "./backend/network-error";
export { ConfiguredEmailProviderLayer } from "./backend/provider-factory";
export { ConsoleEmailProviderLive } from "./backend/providers/console-provider";
export { ResendEmailProviderLive } from "./backend/providers/resend-provider";
export {
  EmailConfigTag,
  EmailProviderTag,
  EmailServiceError,
  EmailServiceTag,
  EmailTemplateServiceTag,
} from "./backend/service";
export type {
  EmailAttachment,
  EmailDeliveryId,
  EmailMessage,
  EmailProviderConfig,
  EmailRecipient,
  EmailSendResult,
  EmailTemplateData,
  EmailTemplateType,
  ReservationConfirmationData,
} from "./types/email.types";
export { EmailDeliveryIdSchema } from "./types/email.types";
