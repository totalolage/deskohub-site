import { Context, Data, type Effect } from "effect";
import type {
  EmailBatchResult,
  EmailConfig,
  EmailMessage,
  EmailSendResult,
} from "../types/email.types";
import type { NetworkError } from "./network-error";

/**
 * Whether a refusal ends the message's delivery or only this provider's
 * attempt:
 *
 * - `provider`: this provider cannot send now and sent nothing, such as a
 *   quota or throttling refusal (HTTP 429), an authentication, scope, or
 *   missing-resource refusal (401, 403, 404), or a paused or suspended
 *   account. A provider chain tries the next provider.
 * - `message`: this message cannot be sent, such as a validation refusal
 *   (400, 422), a suppressed or unreachable recipient, or attachments the
 *   provider cannot carry. A provider chain stops, so no other provider
 *   sends it.
 */
export type EmailFailureKind = "provider" | "message";

/**
 * A provider refused the request and sent nothing. `failureKind` decides
 * whether a provider chain continues (see `EmailFailureKind`); it defaults to
 * `message`, so an error an application raises never moves a message to
 * another provider. `code` is a fixed, non-personal machine code such as
 * `http-429`.
 */
export class EmailServiceError extends Data.TaggedError("EmailServiceError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly provider?: string;
  readonly failureKind: EmailFailureKind;
  readonly code?: string;
}> {
  constructor(
    message: string,
    cause?: unknown,
    provider?: string,
    classification?: {
      readonly failureKind?: EmailFailureKind;
      readonly code?: string;
    }
  ) {
    super({
      message,
      cause,
      provider,
      failureKind: classification?.failureKind ?? "message",
      code: classification?.code,
    });
  }
}

export type EmailSendError = EmailServiceError | NetworkError;

/**
 * Whether a provider chain moves a failed message to its next provider: a
 * provider-level refusal or a provider-level transport failure continues; a
 * message-level refusal or an outcome a replay must settle stops.
 */
export const continuesEmailChain = (error: EmailSendError): boolean =>
  error._tag === "NetworkError"
    ? error.failureKind !== "unknown-outcome"
    : error.failureKind === "provider";

/** Options of one batch request; the key stays the same across retries. */
export interface EmailBatchOptions {
  readonly idempotencyKey: string;
  /**
   * A repeat of a request whose outcome is unknown. Each message stays with
   * the first provider in its chain: a provider-level failure is returned as
   * that message's failure instead of moving it to the next provider, since
   * the earlier request may have reached the provider that answered it.
   */
  readonly replay?: boolean;
}

/**
 * One email provider. A surfaced failure means the provider's own retries
 * are spent.
 */
export interface EmailProvider {
  readonly name: string;
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailSendResult, EmailSendError>;
  /**
   * Sends up to 100 messages. Results follow the message order; a provider
   * that answers per message reports each refused one as an
   * `EmailSendFailure`, one that answers per request fails as a whole. A
   * provider that accepted the key once returns the same result for a
   * repeated request instead of sending again.
   */
  readonly sendBatch: (
    messages: readonly EmailMessage[],
    options: EmailBatchOptions
  ) => Effect.Effect<readonly EmailBatchResult[], EmailSendError>;
}

export class EmailConfigTag extends Context.Service<
  EmailConfigTag,
  EmailConfig
>()("EmailConfig") {}
