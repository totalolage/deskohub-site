import { Context, Data, type Effect, Match } from "effect";
import type {
  EmailConfig,
  EmailMessage,
  EmailSendResult,
} from "../types/email.types";
import type { NetworkError } from "./network-error";

export class EmailServiceError extends Data.TaggedError("EmailServiceError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly provider?: string;
}> {
  constructor(message: string, cause?: unknown, provider?: string) {
    super({ message, cause, provider });
  }
}

export type EmailSendError = EmailServiceError | NetworkError;

/** Options of one batch request; the key stays the same across retries. */
export interface EmailBatchOptions {
  readonly idempotencyKey: string;
}

export interface EmailProvider {
  readonly name: string;
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailSendResult, EmailSendError>;
  /**
   * Sends up to 100 messages in one request. Results follow the message
   * order. A provider that accepted the key once returns the same result for
   * a repeated request instead of sending again.
   */
  readonly sendBatch: (
    messages: readonly EmailMessage[],
    options: EmailBatchOptions
  ) => Effect.Effect<readonly EmailSendResult[], EmailSendError>;
}

export class EmailProviderTag extends Context.Service<
  EmailProviderTag,
  EmailProvider
>()("EmailProvider") {}

export class EmailConfigTag extends Context.Service<
  EmailConfigTag,
  EmailConfig
>()("EmailConfig") {}

export const isRetryableEmailError = (error: EmailSendError) =>
  Match.value(error).pipe(
    Match.tag("NetworkError", () => true),
    Match.orElse(() => false)
  );
