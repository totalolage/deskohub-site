import { Context, Duration, Effect, Layer, Match, Schedule } from "effect";
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

export class EmailProviderTag extends Context.Service<
  EmailProviderTag,
  EmailProvider
>()("EmailProvider") {}

export interface EmailTemplateService {
  readonly render: (
    template: EmailTemplateData
  ) => Effect.Effect<
    { html: string; text: string; subject: string },
    EmailTemplateError
  >;
}

export class EmailTemplateServiceTag extends Context.Service<
  EmailTemplateServiceTag,
  EmailTemplateService
>()("EmailTemplateService") {}

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

export class EmailServiceTag extends Context.Service<
  EmailServiceTag,
  EmailService
>()("EmailService") {}

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

const getEmailRetryPolicyDescription = (
  error: EmailServiceError | NetworkError
) =>
  isRetryableEmailError(error)
    ? "exponential backoff (1s base, jittered, max 3 attempts)"
    : "no retry - not a network error";

const emailRetryPolicy = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.while<EmailServiceError | NetworkError, Duration.Duration>(
    ({ input }) => isRetryableEmailError(input)
  ),
  Schedule.both(Schedule.recurs(3)),
  Schedule.tapOutput(([duration, attempt]) =>
    Effect.logWarning(
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
      send: Effect.fn("email.send")(
        function* (message: EmailMessage) {
          yield* Effect.annotateLogsScoped({ message });
          yield* Effect.logInfo("Email send started", {
            provider: provider.name,
          });

          const finalMessage = {
            ...message,
            from: message.from || config.defaultFrom,
          };
          yield* Effect.annotateLogsScoped({ finalMessage });

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
                  willRetry: isRetryableEmailError(error),
                  recipient: Array.isArray(finalMessage.to)
                    ? finalMessage.to.map((r) => r.email || r)
                    : finalMessage.to.email || finalMessage.to,
                  subject: finalMessage.subject,
                  retryPolicy: getEmailRetryPolicyDescription(error),
                }
              )
            ),
            Effect.retry(emailRetryPolicy),
            Effect.tap((sendResult) =>
              Effect.gen(function* () {
                yield* Effect.annotateLogsScoped({ result: sendResult });
                yield* Effect.logInfo("Email sent successfully", {
                  id: sendResult.id,
                  provider: sendResult.provider,
                  recipient: Array.isArray(finalMessage.to)
                    ? finalMessage.to.map((r) => r.email || r)
                    : finalMessage.to.email || finalMessage.to,
                  subject: finalMessage.subject,
                });
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
        },
        (effect, message) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({ provider: provider.name, message })
          )
      ),

      sendTemplate: Effect.fn("email.sendTemplate")(
        function* (recipient, template) {
          yield* Effect.annotateLogsScoped({ recipient, template });
          yield* Effect.logInfo("Template email send started", {
            provider: provider.name,
            template: template.type,
          });

          const rendered = yield* templateService.render(template);
          yield* Effect.annotateLogsScoped({ rendered });
          yield* Effect.logDebug("Template email rendered", {
            template: template.type,
          });

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
          yield* Effect.annotateLogsScoped({ message });

          return yield* provider.send(message).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(
                "Template email failed, will retry if NetworkError",
                {
                  errorType: error._tag,
                  errorMessage: error.message,
                  willRetry: isRetryableEmailError(error),
                  template: template.type,
                  recipient: to.email,
                  subject: message.subject,
                  retryPolicy: getEmailRetryPolicyDescription(error),
                }
              )
            ),
            Effect.retry(emailRetryPolicy),
            Effect.tap((sendResult) =>
              Effect.gen(function* () {
                yield* Effect.annotateLogsScoped({ result: sendResult });
                yield* Effect.logInfo("Template email sent successfully", {
                  id: sendResult.id,
                  template: template.type,
                  recipient: to.email,
                  subject: message.subject,
                });
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
        },
        (effect, recipient, template) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({
              provider: provider.name,
              recipient,
              template,
            })
          )
      ),

      verify: Effect.fn("email.verify")(
        function* () {
          yield* Effect.logInfo("Verifying email service configuration", {
            provider: provider.name,
          });

          const isValid = yield* provider.verify().pipe(
            Effect.tap((valid) =>
              Effect.gen(function* () {
                yield* Effect.annotateLogsScoped({ result: valid });
                if (valid) {
                  yield* Effect.logInfo("Email service verified successfully", {
                    provider: provider.name,
                  });
                } else {
                  yield* Effect.logWarning(
                    "Email service verification failed",
                    {
                      provider: provider.name,
                    }
                  );
                }
              })
            ),
            Effect.tapError((error) =>
              Effect.logError("Email service verification failed", {
                provider: provider.name,
                errorType: error._tag,
                errorMessage: error.message,
              })
            )
          );

          return isValid;
        },
        (effect) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({ provider: provider.name })
          )
      ),
    };
  })
);
