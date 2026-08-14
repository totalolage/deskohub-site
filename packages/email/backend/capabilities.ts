import { Context, type Effect, Match } from "effect";
import type {
  EmailMessage,
  EmailProviderConfig,
  EmailSendResult,
} from "../types/email.types";
import type { NetworkError } from "./network-error";

export class EmailServiceError {
  readonly _tag = "EmailServiceError";
  constructor(
    readonly message: string,
    readonly cause?: unknown,
    readonly provider?: string
  ) {}
}

export class EmailTemplateError {
  readonly _tag = "EmailTemplateError";
  constructor(
    readonly message: string,
    readonly template: string,
    readonly cause?: unknown
  ) {}
}

export interface EmailProvider {
  readonly name: string;
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailSendResult, EmailServiceError | NetworkError>;
  readonly verify: Effect.Effect<boolean, EmailServiceError>;
}

export class EmailProviderTag extends Context.Service<
  EmailProviderTag,
  EmailProvider
>()("EmailProvider") {}

export class EmailConfigTag extends Context.Service<
  EmailConfigTag,
  EmailProviderConfig
>()("EmailConfig") {}

export const isRetryableEmailError = (
  error: EmailServiceError | NetworkError
) =>
  Match.value(error).pipe(
    Match.tag("NetworkError", () => true),
    Match.orElse(() => false)
  );
