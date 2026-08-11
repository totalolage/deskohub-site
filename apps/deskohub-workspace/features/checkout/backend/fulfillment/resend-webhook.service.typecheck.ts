import type { EmailDeliveryId } from "@deskohub/email";
import type {
  ResendEmailId,
  ResendWebhookEventId,
} from "./resend-webhook.service";

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type AssertFalse<Value extends false> = Value;
type AssertTrue<Value extends true> = Value;

export type RawStringIsNotResendWebhookEventId = AssertFalse<
  IsAssignable<string, ResendWebhookEventId>
>;
export type RawStringIsNotResendEmailId = AssertFalse<
  IsAssignable<string, ResendEmailId>
>;
export type ResendEmailIdIsNotWebhookEventId = AssertFalse<
  IsAssignable<ResendEmailId, ResendWebhookEventId>
>;
export type ResendWebhookEventIdIsNotEmailId = AssertFalse<
  IsAssignable<ResendWebhookEventId, ResendEmailId>
>;
export type ResendWebhookEventIdIsNotDeliveryId = AssertFalse<
  IsAssignable<ResendWebhookEventId, EmailDeliveryId>
>;
export type ResendEmailIdIsAnEmailDeliveryId = AssertTrue<
  IsAssignable<ResendEmailId, EmailDeliveryId>
>;
export type GenericDeliveryIdIsNotProviderSpecific = AssertFalse<
  IsAssignable<EmailDeliveryId, ResendEmailId>
>;
