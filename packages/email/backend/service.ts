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

/** Log only non-PII send facts; recipients and rendered bodies stay out. */
const emailSendLogFacts = (message: {
  html?: string;
  text?: string;
  tags?: string[];
}) => ({
  category: message.tags?.[0],
  hasHtml: !!message.html,
  hasText: !!message.text,
});

/** Provider logs receive fixed codes and tags, never raw error messages. */
const emailFailureLogFacts = (error: EmailServiceError | NetworkError) => ({
  code: isRetryableEmailError(error)
    ? "email.send.transport-retryable"
    : "email.send.rejected",
  errorType: error._tag,
});

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
        yield* Effect.logInfo("Email send started", {
          provider: provider.name,
          ...emailSendLogFacts(message),
        });

        const finalMessage = {
          ...message,
          from: message.from || config.defaultFrom,
        };

        const result = yield* provider.send(finalMessage).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Email send failed, will retry if NetworkError", {
              ...emailFailureLogFacts(error),
              willRetry: isRetryableEmailError(error),
              retryPolicy: getEmailRetryPolicyDescription(error),
            })
          ),
          Effect.retry(emailRetryPolicy),
          Effect.tap((sendResult) =>
            Effect.logInfo("Email sent successfully", {
              id: sendResult.id,
              provider: sendResult.provider,
            })
          ),
          Effect.tapError((error) =>
            Effect.logError("Email send failed - all retries exhausted", {
              ...emailFailureLogFacts(error),
              provider: provider.name,
              maxRetriesReached: true,
            })
          )
        );

        return result;
      },
      (effect, message) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({
            provider: provider.name,
            ...emailSendLogFacts(message),
          })
        )
    ),

    sendTemplate: Effect.fn("email.sendTemplate")(
      function* (recipient, template) {
        yield* Effect.logInfo("Template email send started", {
          provider: provider.name,
          template: template.type,
        });

        const rendered = yield* templateService.render(template);
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

        return yield* provider.send(message).pipe(
          Effect.tapError((error) =>
            Effect.logWarning(
              "Template email failed, will retry if NetworkError",
              {
                ...emailFailureLogFacts(error),
                willRetry: isRetryableEmailError(error),
                template: template.type,
                retryPolicy: getEmailRetryPolicyDescription(error),
              }
            )
          ),
          Effect.retry(emailRetryPolicy),
          Effect.tap((sendResult) =>
            Effect.logInfo("Template email sent successfully", {
              id: sendResult.id,
              template: template.type,
            })
          ),
          Effect.tapError((error) =>
            Effect.logError("Template email failed - all retries exhausted", {
              ...emailFailureLogFacts(error),
              template: template.type,
              maxRetriesReached: true,
            })
          )
        );
      },
      (effect, _recipient, template) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({
            provider: provider.name,
            template: template.type,
          })
        )
    ),

    verify: Effect.gen(function* () {
      yield* Effect.logInfo("Verifying email service configuration", {
        provider: provider.name,
      });

      return yield* provider.verify.pipe(
        Effect.tap((valid) => {
          if (valid) {
            return Effect.logInfo("Email service verified successfully", {
              provider: provider.name,
            });
          }
          return Effect.logWarning("Email service verification failed", {
            provider: provider.name,
          });
        }),
        Effect.tapError((error) =>
          Effect.logError("Email service verification failed", {
            ...emailFailureLogFacts(error),
            provider: provider.name,
          })
        )
      );
    }).pipe(
      Effect.scoped,
      Effect.annotateLogs({ provider: provider.name }),
      Effect.withSpan("email.verify")
    ),
  };
});
