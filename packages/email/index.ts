export {
  continuesEmailChain,
  type EmailBatchOptions,
  type EmailFailureKind,
  type EmailProvider,
} from "./backend/capabilities";
export {
  EmailDeliveryObserver,
  type EmailFallbackEvent,
  type EmailSentEvent,
} from "./backend/email-delivery-observer";
export { makeEmailConfigLayer } from "./backend/email-config";
export {
  type EmailProviderChains,
  EmailProviders,
  type EmailStream,
} from "./backend/email-providers";
export {
  internalRecipientForOrigin,
  staffEmailSubject,
} from "./backend/email-routing";
export { NetworkError, type NetworkFailureKind } from "./backend/network-error";
export { isConsoleEmailDeliveryId } from "./backend/providers/console-provider";
export {
  EmailConfigTag,
  type EmailSendError,
  EmailServiceError,
  EmailServiceTag,
} from "./backend/service";
export { isTestEmailRecipient } from "./backend/test-recipients";
export type {
  EmailAttachment,
  EmailBatchResult,
  EmailConfig,
  EmailDeliveryId,
  EmailMessage,
  EmailProviderConfig,
  EmailRecipient,
  EmailSendFailure,
  EmailSendResult,
} from "./types/email.types";
export { EmailDeliveryIdSchema } from "./types/email.types";
