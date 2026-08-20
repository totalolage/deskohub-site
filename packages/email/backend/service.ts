import { Context, Duration, Effect, Layer, Schedule } from "effect";
import type {
  EmailMessage,
  EmailSendResult,
  EmailTemplateData,
} from "../types/email.types";
import {
  EmailConfigTag,
  EmailProviderTag,
  type EmailServiceError,
  type EmailTemplateError,
  isRetryableEmailError,
} from "./capabilities";
import type { NetworkError } from "./network-error";
import { ConfiguredEmailProviderLayer } from "./provider-factory";

export {
  EmailConfigTag,
  type EmailProvider,
  EmailProviderTag,
  EmailServiceError,
  EmailTemplateError,
  isRetryableEmailError,
} from "./capabilities";

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
>()("EmailTemplateService") {
  static Default = Layer.succeed(this, {
    render: Effect.fn("emailTemplateService.render")(function* (
      template: EmailTemplateData
    ) {
      yield* Effect.logDebug("Rendering email template", {
        type: template.type,
      });

      const result = {
        subject: `[${template.type}] Notification`,
        html: `<p>Template: ${template.type}</p><pre>${JSON.stringify(template.data, null, 2)}</pre>`,
        text: `Template: ${template.type}\n\n${JSON.stringify(template.data, null, 2)}`,
      };

      yield* Effect.logDebug("Template rendered successfully", {
        type: template.type,
        subjectLength: result.subject.length,
        htmlLength: result.html.length,
        textLength: result.text.length,
      });

      return result;
    }),
  });
}

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
  readonly verify: Effect.Effect<boolean, EmailServiceError>;
}

export class EmailServiceTag extends Context.Service<
  EmailServiceTag,
  EmailService
>()("EmailService") {
  static Default = Layer.effect(
    this,
    Effect.suspend(() => emailServiceImplementation)
  );

  static Live = this.Default.pipe(
    Layer.provide(EmailTemplateServiceTag.Default),
    Layer.provide(ConfiguredEmailProviderLayer)
  );
}

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

const emailServiceImplementation = Effect.gen(function* () {
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
            Effect.logWarning("Email send failed, will retry if NetworkError", {
              errorType: error._tag,
              errorMessage: error.message,
              willRetry: isRetryableEmailError(error),
              recipient: Array.isArray(finalMessage.to)
                ? finalMessage.to.map((r) => r.email || r)
                : finalMessage.to.email || finalMessage.to,
              subject: finalMessage.subject,
              retryPolicy: getEmailRetryPolicyDescription(error),
            })
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

    verify: Effect.gen(function* () {
      yield* Effect.logInfo("Verifying email service configuration", {
        provider: provider.name,
      });

      const isValid = yield* provider.verify.pipe(
        Effect.tap((valid) =>
          Effect.gen(function* () {
            yield* Effect.annotateLogsScoped({ result: valid });
            if (valid) {
              yield* Effect.logInfo("Email service verified successfully", {
                provider: provider.name,
              });
            } else {
              yield* Effect.logWarning("Email service verification failed", {
                provider: provider.name,
              });
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
    }).pipe(
      Effect.scoped,
      Effect.annotateLogs({ provider: provider.name }),
      Effect.withSpan("email.verify")
    ),
  };
});
