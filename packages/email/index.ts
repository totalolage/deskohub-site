export type {
  EmailBatchOptions,
  EmailProvider,
} from "./backend/capabilities";
export { makeEmailConfigLayer } from "./backend/email-config";
export {
  internalRecipientForOrigin,
  staffEmailSubject,
} from "./backend/email-routing";
export { NetworkError } from "./backend/network-error";
export { ConfiguredEmailProviderLayer } from "./backend/provider-factory";
export {
  ConsoleEmailProviderLive,
  isConsoleEmailDeliveryId,
} from "./backend/providers/console-provider";
export { ResendEmailProviderLive } from "./backend/providers/resend-provider";
export {
  EmailConfigTag,
  EmailProviderTag,
  type EmailSendError,
  EmailServiceError,
  EmailServiceTag,
} from "./backend/service";
export { isTestEmailRecipient } from "./backend/test-recipients";
export type {
  EmailAttachment,
  EmailConfig,
  EmailDeliveryId,
  EmailMessage,
  EmailProviderConfig,
  EmailRecipient,
  EmailSendResult,
} from "./types/email.types";
export { EmailDeliveryIdSchema } from "./types/email.types";
