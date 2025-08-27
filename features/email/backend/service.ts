/**
 * Email Service
 *
 * Core email service that provides a provider-agnostic interface
 * for sending emails. Uses Effect for error handling and composition.
 */

import { Context, Duration, Effect, Layer, Schedule } from "effect";
import type { NetworkError } from "@/shared/backend/errors";
import type {
  EmailMessage,
  EmailProviderConfig,
  EmailSendResult,
  EmailTemplateData,
} from "../types/email.types";

/**
 * Email service errors
 */
export class EmailServiceError {
  readonly _tag = "EmailServiceError";
  constructor(
    readonly message: string,
    readonly cause?: unknown,
    readonly provider?: string
  ) {}
}

/**
 * Email template rendering error
 */
export class EmailTemplateError {
  readonly _tag = "EmailTemplateError";
  constructor(
    readonly message: string,
    readonly template: string,
    readonly cause?: unknown
  ) {}
}

/**
 * Email Provider Interface
 *
 * All email providers must implement this interface
 */
export interface EmailProvider {
  readonly name: string;
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailSendResult, EmailServiceError | NetworkError>;
  readonly verify: () => Effect.Effect<boolean, EmailServiceError>;
}

/**
 * Email Provider Tag for dependency injection
 */
export class EmailProviderTag extends Context.Tag("EmailProvider")<
  EmailProviderTag,
  EmailProvider
>() {}

/**
 * Email Template Service
 *
 * Renders email templates with data
 */
export interface EmailTemplateService {
  readonly render: (
    template: EmailTemplateData
  ) => Effect.Effect<
    { html: string; text: string; subject: string },
    EmailTemplateError
  >;
}

/**
 * Email Template Service Tag
 */
export class EmailTemplateServiceTag extends Context.Tag(
  "EmailTemplateService"
)<EmailTemplateServiceTag, EmailTemplateService>() {}

/**
 * Main Email Service Interface
 */
export interface EmailService {
  /**
   * Send a raw email message
   */
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailSendResult, EmailServiceError | NetworkError>;

  /**
   * Send a templated email
   */
  readonly sendTemplate: (
    recipient: string | { email: string; name?: string },
    template: EmailTemplateData
  ) => Effect.Effect<
    EmailSendResult,
    EmailServiceError | NetworkError | EmailTemplateError
  >;

  /**
   * Verify email service is configured and working
   */
  readonly verify: () => Effect.Effect<boolean, EmailServiceError>;
}

/**
 * Email Service Tag for dependency injection
 */
export class EmailServiceTag extends Context.Tag("EmailService")<
  EmailServiceTag,
  EmailService
>() {}

/**
 * Email Configuration Tag
 */
export class EmailConfigTag extends Context.Tag("EmailConfig")<
  EmailConfigTag,
  EmailProviderConfig
>() {}

/**
 * Retry policy for email sending
 * - Exponential backoff starting at 1 second
 * - Maximum 3 retries (hard limit)
 * - Only retry on network errors
 */
const emailRetryPolicy = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  // Use intersect to ensure BOTH conditions must be met (not either/or)
  Schedule.intersect(Schedule.recurs(3)), // Maximum 3 retries AND exponential backoff
  Schedule.whileInput<EmailServiceError | NetworkError>((error) => {
    // Only retry on network errors
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
  ),
  Schedule.map(() => void 0)
);

/**
 * Email Service Implementation
 */
const EmailServiceLive = Layer.effect(
  EmailServiceTag,
  Effect.gen(function* () {
    const provider = yield* EmailProviderTag;
    const templateService = yield* EmailTemplateServiceTag;
    const config = yield* EmailConfigTag;

    return {
      send: (message: EmailMessage) =>
        Effect.gen(function* () {
          // Add default from if not specified
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
            // Log before retry
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
            // Apply retry policy
            Effect.retry(emailRetryPolicy),
            Effect.tap((result) =>
              Effect.logInfo("Email sent successfully", {
                id: result.id,
                provider: result.provider,
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
          // Render the template
          const rendered = yield* templateService.render(template);

          // Prepare recipient
          const to =
            typeof recipient === "string" ? { email: recipient } : recipient;

          // Create email message
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

          // Send the email
          return yield* provider.send(message).pipe(
            // Log before retry
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
            // Apply retry policy
            Effect.retry(emailRetryPolicy),
            Effect.tap((result) =>
              Effect.logInfo("Template email sent successfully", {
                id: result.id,
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

/**
 * Export the complete email service layer
 * This needs to be provided with:
 * - EmailProviderTag (specific provider implementation)
 * - EmailTemplateServiceTag (template rendering)
 * - EmailConfigTag (configuration)
 */
export { EmailServiceLive };
