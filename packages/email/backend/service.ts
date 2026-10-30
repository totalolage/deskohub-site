import { Context, Duration, Effect, Layer, Match, Schedule } from "effect";
import type { EmailMessage, EmailSendResult } from "../types/email.types";
import {
  type EmailBatchOptions,
  EmailConfigTag,
  EmailProviderTag,
  type EmailSendError,
  isRetryableEmailError,
} from "./capabilities";
import { RoutedEmailProviderLive } from "./email-routing";
import { ConfiguredEmailProviderLayer } from "./provider-factory";

export {
  type EmailBatchOptions,
  EmailConfigTag,
  type EmailProvider,
  EmailProviderTag,
  type EmailSendError,
  EmailServiceError,
  isRetryableEmailError,
} from "./capabilities";

export interface EmailService {
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailSendResult, EmailSendError>;
  /**
   * Sends up to 100 messages in one provider request, exactly once. A retry
   * after an unknown outcome is the caller's: it replays the identical batch
   * under the same idempotency key, and only it knows whether an earlier
   * request may have been accepted. Results follow the message order.
   */
  readonly sendBatch: (
    messages: readonly EmailMessage[],
    options: EmailBatchOptions
  ) => Effect.Effect<readonly EmailSendResult[], EmailSendError>;
}

export class EmailServiceTag extends Context.Service<
  EmailServiceTag,
  EmailService
>()("EmailService") {
  static Default = Layer.effect(
    this,
    Effect.suspend(() => emailServiceImplementation)
  );

  /** Sends through the one provider `EmailConfig.provider` selects. */
  static Live = this.Default.pipe(Layer.provide(ConfiguredEmailProviderLayer));

  /**
   * Routes each message by recipient: only `EMAIL_TEST_DOMAIN` recipients go
   * to Console, everything else to Resend; without a Resend key every message
   * goes to Console. Ignores `provider` and `testMode`.
   */
  static RecipientRouted = this.Default.pipe(
    Layer.provide(RoutedEmailProviderLive)
  );
}

const getEmailRetryPolicyDescription = (error: EmailSendError) =>
  isRetryableEmailError(error)
    ? "exponential backoff (1s base, jittered, max 3 retries)"
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
const emailFailureLogFacts = (error: EmailSendError) => ({
  code: Match.value(error).pipe(
    Match.tag("NetworkError", () => "email.send.transport-retryable"),
    Match.orElse(() => "email.send.rejected")
  ),
  errorType: error._tag,
});

const emailRetryPolicy = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.while<EmailSendError, Duration.Duration>(({ input }) =>
    isRetryableEmailError(input)
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
  const config = yield* EmailConfigTag;

  return {
    send: Effect.fn("email.send")(
      function* (message: EmailMessage) {
        yield* Effect.logInfo("Email send started", {
          provider: provider.name,
          ...emailSendLogFacts(message),
        });

        const finalMessage = yield* withDeliveryIdempotencyKey({
          ...message,
          from: message.from || config.defaultFrom,
        });

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

    sendBatch: Effect.fn("email.sendBatch")(
      function* (
        messages: readonly EmailMessage[],
        options: EmailBatchOptions
      ) {
        yield* Effect.logInfo("Email batch send started", {
          provider: provider.name,
          size: messages.length,
          category: messages[0]?.tags?.[0],
        });

        return yield* provider
          .sendBatch(
            messages.map((message) => ({
              ...message,
              from: message.from || config.defaultFrom,
            })),
            options
          )
          .pipe(
            Effect.tap((results) =>
              Effect.logInfo("Email batch sent successfully", {
                size: results.length,
                provider: provider.name,
              })
            ),
            Effect.tapError((error) =>
              Effect.logError("Email batch send failed", {
                ...emailFailureLogFacts(error),
                provider: provider.name,
              })
            )
          );
      },
      (effect, messages) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({
            provider: provider.name,
            category: messages[0]?.tags?.[0],
          })
        )
    ),
  };
});

/**
 * One logical delivery keeps one idempotency key across transport retries, so
 * a provider that accepted a timed-out attempt does not deliver it twice.
 */
const withDeliveryIdempotencyKey = (message: EmailMessage) =>
  Effect.sync(
    (): EmailMessage => ({
      ...message,
      idempotencyKey:
        message.idempotencyKey ??
        reservationDeliveryIdempotencyKey(message) ??
        `email-delivery-${crypto.randomUUID()}`,
    })
  );

/** A reservation delivery category is sent at most once per reservation. */
const reservationDeliveryIdempotencyKey = (message: EmailMessage) => {
  const workspaceReservationId = message.metadata?.workspaceReservationId;
  const category = message.tags?.[0];

  if (
    typeof workspaceReservationId !== "string" ||
    typeof category !== "string"
  ) {
    return undefined;
  }

  return `${category}-${workspaceReservationId}`;
};
