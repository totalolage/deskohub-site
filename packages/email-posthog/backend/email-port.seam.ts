/**
 * seam: the provider-chain port that `@deskohub/email` gains on
 * subagent/pheml-s1-email-core (agreed peer messages pheml-s1-peer-s2-1 and
 * pheml-s1-peer-s2-2). Until that branch lands, this module models it on top
 * of the current exports. At integration, replace each declaration with the
 * matching `@deskohub/email` export:
 *
 * - `emailServiceFailure` -> `new EmailServiceError(message, undefined, provider, { failureKind, code })`
 * - `networkFailure` -> `new NetworkError({ message, code, failureKind })`
 * - `EmailSendFailure`, `EmailBatchResult`, `EmailFailureKind`, `NetworkFailureKind`, `EmailProvider` -> the exports of the same names
 * - `RoutedEmailMessage` -> `EmailMessage` (which carries `recipientIdentity`)
 */
import {
  type EmailMessage,
  type EmailSendResult,
  EmailServiceError,
  NetworkError,
} from "@deskohub/email";
import type { Effect } from "effect";

/** "provider": the next provider may send the message. "message": no provider may. */
export type EmailFailureKind = "provider" | "message";

/** "provider": the next provider may send the message. "unknown-outcome": the provider may still deliver it, so the chain stops and the caller replays under the same key. */
export type NetworkFailureKind = "provider" | "unknown-outcome";

export type ClassifiedEmailServiceError = EmailServiceError & {
  readonly failureKind: EmailFailureKind;
  readonly code: string;
};

export type ClassifiedNetworkError = NetworkError & {
  readonly failureKind: NetworkFailureKind;
  readonly code: string;
};

export type ClassifiedEmailSendError =
  | ClassifiedEmailServiceError
  | ClassifiedNetworkError;

export const emailServiceFailure = (
  message: string,
  provider: string,
  options: { readonly failureKind: EmailFailureKind; readonly code: string }
): ClassifiedEmailServiceError =>
  Object.assign(new EmailServiceError(message, undefined, provider), options);

export const networkFailure = (options: {
  readonly message: string;
  readonly code: string;
  readonly failureKind: NetworkFailureKind;
}): ClassifiedNetworkError =>
  Object.assign(new NetworkError({ message: options.message }), {
    code: options.code,
    failureKind: options.failureKind,
  });

/** A message of a batch that the provider did not accept. */
export interface EmailSendFailure {
  readonly status: "failed";
  readonly provider: string;
  readonly timestamp: Date;
  readonly error: ClassifiedEmailSendError;
}

export type EmailBatchResult = EmailSendResult | EmailSendFailure;

/** seam: recipientIdentity from @deskohub/email */
export type RoutedEmailMessage = EmailMessage & {
  readonly recipientIdentity?: string;
};

export interface EmailProvider {
  readonly name: string;
  readonly send: (
    message: RoutedEmailMessage
  ) => Effect.Effect<EmailSendResult, ClassifiedEmailSendError>;
  readonly sendBatch: (
    messages: readonly RoutedEmailMessage[],
    options: { readonly idempotencyKey: string }
  ) => Effect.Effect<readonly EmailBatchResult[]>;
}
