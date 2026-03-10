import { Context, Duration, Effect, Layer, Schedule } from "effect";
import type {
  EmailMessage,
  EmailProviderConfig,
  EmailSendResult,
  EmailTemplateData,
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
  readonly verify: () => Effect.Effect<boolean, EmailServiceError>;
}

export class EmailProviderTag extends Context.Tag("EmailProvider")<
  EmailProviderTag,
  EmailProvider
>() {}

export interface EmailTemplateService {
  readonly render: (
    template: EmailTemplateData
  ) => Effect.Effect<
    { html: string; text: string; subject: string },
    EmailTemplateError
  >;
}

export class EmailTemplateServiceTag extends Context.Tag(
  "EmailTemplateService"
)<EmailTemplateServiceTag, EmailTemplateService>() {}

export interface EmailService {
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailSendResult, EmailServiceError | NetworkError>;
  readonly sendTemplate: (
    recipient: string | { email: string; name?: string },
    template: EmailTemplateData
  ) => Effect.Effect<
    EmailSendResult,
    EmailServiceError | NetworkError | EmailTemplateError
  >;
  readonly verify: () => Effect.Effect<boolean, EmailServiceError>;
}

export class EmailServiceTag extends Context.Tag("EmailService")<
  EmailServiceTag,
  EmailService
>() {}

export class EmailConfigTag extends Context.Tag("EmailConfig")<
  EmailConfigTag,
  EmailProviderConfig
>() {}

const emailRetryPolicy = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3)),
  Schedule.whileInput<EmailServiceError | NetworkError>((error) => {
    return error._tag === "NetworkError";
  }),
  Schedule.tapOutput(([duration, attempt]) =>
    Effect.logInfo(
      `Email retry attempt #${attempt + 1} starting after ${Duration.toMillis(duration)}ms delay`,
      {
        attemptNumber: attempt + 1,
        delayMs: Duration.toMillis(duration),
        maxRetries: 3,
      }
    )
  )
);

export const EmailServiceLive = Layer.effect(
  EmailServiceTag,
  Effect.gen(function* () {
    const provider = yield* EmailProviderTag;
    const templateService = yield* EmailTemplateServiceTag;
    const config = yield* EmailConfigTag;

    return {
      send: (message: EmailMessage) =>
        Effect.gen(function* () {
          const finalMessage = {
            ...message,
            from: message.from || config.defaultFrom,
          };

          yield* Effect.logInfo("Sending email", {
            to: Array.isArray(finalMessage.to)
              ? finalMessage.to.map((r) => r.email || r)
              : finalMessage.to.email || finalMessage.to,
            subject: finalMessage.subject,
            provider: provider.name,
          });

          const result = yield* provider.send(finalMessage).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(
                "Email send failed, will retry if NetworkError",
                {
                  errorType: error._tag,
                  errorMessage: error.message,
                  willRetry: error._tag === "NetworkError",
                  recipient: Array.isArray(finalMessage.to)
                    ? finalMessage.to.map((r) => r.email || r)
                    : finalMessage.to.email || finalMessage.to,
                  subject: finalMessage.subject,
                  retryPolicy:
                    error._tag === "NetworkError"
                      ? "exponential backoff (1s base, jittered, max 3 attempts)"
                      : "no retry - not a network error",
                }
              )
            ),
            Effect.retry(emailRetryPolicy),
            Effect.tap((sendResult) =>
              Effect.logInfo("Email sent successfully", {
                id: sendResult.id,
                provider: sendResult.provider,
                recipient: Array.isArray(finalMessage.to)
                  ? finalMessage.to.map((r) => r.email || r)
                  : finalMessage.to.email || finalMessage.to,
                subject: finalMessage.subject,
              })
            ),
            Effect.tapError((error) =>
              Effect.logError("Email send failed - all retries exhausted", {
                errorType: error._tag,
                errorMessage: error.message,
                provider: provider.name,
                recipient: Array.isArray(finalMessage.to)
                  ? finalMessage.to.map((r) => r.email || r)
                  : finalMessage.to.email || finalMessage.to,
                subject: finalMessage.subject,
                maxRetriesReached: true,
              })
            )
          );

          return result;
        }),

      sendTemplate: (recipient, template) =>
        Effect.gen(function* () {
          const rendered = yield* templateService.render(template);
          const to =
            typeof recipient === "string" ? { email: recipient } : recipient;

          const message: EmailMessage = {
            from: config.defaultFrom,
            to,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            tags: [template.type],
            metadata: {
              templateType: template.type,
            },
          };

          return yield* provider.send(message).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(
                "Template email failed, will retry if NetworkError",
                {
                  errorType: error._tag,
                  errorMessage: error.message,
                  willRetry: error._tag === "NetworkError",
                  template: template.type,
                  recipient: to.email,
                  subject: message.subject,
                  retryPolicy:
                    error._tag === "NetworkError"
                      ? "exponential backoff (1s base, jittered, max 3 attempts)"
                      : "no retry - not a network error",
                }
              )
            ),
            Effect.retry(emailRetryPolicy),
            Effect.tap((sendResult) =>
              Effect.logInfo("Template email sent successfully", {
                id: sendResult.id,
                template: template.type,
                recipient: to.email,
                subject: message.subject,
              })
            ),
            Effect.tapError((error) =>
              Effect.logError("Template email failed - all retries exhausted", {
                errorType: error._tag,
                errorMessage: error.message,
                template: template.type,
                recipient: to.email,
                subject: message.subject,
                maxRetriesReached: true,
              })
            )
          );
        }),

      verify: () =>
        Effect.gen(function* () {
          yield* Effect.logInfo("Verifying email service configuration");

          const isValid = yield* provider.verify().pipe(
            Effect.tap((valid) =>
              valid
                ? Effect.logInfo("Email service verified successfully", {
                    provider: provider.name,
                  })
                : Effect.logWarning("Email service verification failed", {
                    provider: provider.name,
                  })
            )
          );

          return isValid;
        }),
    };
  })
);
