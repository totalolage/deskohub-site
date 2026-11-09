import { createHash, randomUUID } from "node:crypto";
import {
  EmailDeliveryIdSchema,
  type EmailRecipient,
  type EmailSendResult,
} from "@deskohub/email";
import {
  Clock,
  Data,
  Duration,
  Effect,
  Match,
  Redacted,
  Ref,
  Schema,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import {
  type ClassifiedEmailSendError,
  type EmailBatchResult,
  type EmailProvider,
  type EmailSendFailure,
  emailServiceFailure,
  networkFailure,
  type RoutedEmailMessage,
} from "./email-port.seam";
import {
  type PostHogEmailConnection,
  postHogAppHost,
  postHogEmailAttemptTimeout,
  postHogEmailMaxRetryAfter,
  postHogEmailRetryPolicy,
} from "./posthog-email-connection";
import { postHogFailureCode, readRetryAfter } from "./posthog-email-response";

/** How the PostHog email provider sends. */
export interface PostHogEmailProviderConfig extends PostHogEmailConnection {
  /**
   * The PostHog distinct id of a message without a `recipientIdentity`, so
   * PostHog never keys a person by the recipient's address.
   */
  readonly systemIdentity: string;
  /** Overrides each message's sender, as `email` or `Name <email>`. */
  readonly from?: string;
}

const providerName = "posthog";
const sendPath = "/api/projects/@current/messaging/send/email/";

/** PostHog takes one recipient, and up to ten addresses per address list. */
const maxListedAddresses = 10;
const maxTemplateKeyLength = 400;
const idempotencyKeyPattern = /^[\x21-\x7e]{1,255}$/;

/**
 * A batch stops starting sends after 15 seconds, in every deployment, so the
 * campaign queue run keeps time for the next provider. Sends in flight at the
 * deadline are abandoned with an unknown outcome.
 */
const batchDeadline = Duration.seconds(15);
const batchConcurrency = 4;

/**
 * Sends email through PostHog's transactional email API in code mode, with
 * the message's rendered HTML and text. Every failure is classified for the
 * provider chain; see the package index for the table.
 */
export const makePostHogEmailProvider = (
  config: PostHogEmailProviderConfig
): EmailProvider => {
  const prepare = (message: RoutedEmailMessage) =>
    Effect.map(refuseUncarriable(message), (carried) =>
      toPostHogEmail(carried, config)
    );

  return {
    name: providerName,

    send: Effect.fn("PostHogEmailProvider.send")(
      function* (message: RoutedEmailMessage) {
        yield* logDroppedHeaders([message]);
        const idempotencyKey = yield* messageIdempotencyKey(
          message.idempotencyKey
        );
        return yield* prepare(message).pipe(
          Effect.flatMap((email) =>
            requestSend({
              config,
              email,
              idempotencyKey,
              maxRetryAfter: postHogEmailMaxRetryAfter,
            })
          ),
          Effect.tapError(logSendFailure)
        );
      },
      (effect, message) =>
        effect.pipe(
          Effect.annotateLogs({
            provider: providerName,
            category: message.tags?.[0],
          })
        )
    ),

    sendBatch: Effect.fn("PostHogEmailProvider.sendBatch")(
      function* (messages, options) {
        yield* logDroppedHeaders(messages);
        const deadline =
          (yield* Clock.currentTimeMillis) + Duration.toMillis(batchDeadline);
        const stopped = yield* Ref.make(false);

        const sendOne = Effect.fn("PostHogEmailProvider.sendBatchMessage")(
          function* (message: RoutedEmailMessage, index: number) {
            if (yield* Ref.get(stopped)) {
              return yield* failedResult(notAttempted);
            }
            const remaining = deadline - (yield* Clock.currentTimeMillis);
            if (remaining <= 0) return yield* failedResult(pastDeadline);

            const idempotencyKey = yield* messageIdempotencyKey(
              message.idempotencyKey ?? `${options.idempotencyKey}:${index}`
            );
            const maxRetryAfter = Duration.min(
              postHogEmailMaxRetryAfter,
              Duration.millis(remaining)
            );
            // A message PostHog cannot carry says nothing about PostHog, so
            // only a failed request stops the batch.
            const sent = prepare(message).pipe(
              Effect.flatMap((email) =>
                requestSend({
                  config,
                  email,
                  idempotencyKey,
                  maxRetryAfter,
                }).pipe(
                  Effect.timeoutOrElse({
                    duration: Duration.millis(remaining),
                    orElse: () => Effect.fail(abandonedAtDeadline()),
                  }),
                  Effect.tapError((error) =>
                    Effect.when(
                      Ref.set(stopped, true),
                      Effect.succeed(failsProvider(error))
                    )
                  )
                )
              ),
              Effect.tapError(logSendFailure)
            );
            return yield* sent.pipe(
              Effect.map((result): EmailBatchResult => result),
              Effect.catch((error) => failedResult(() => error))
            );
          }
        );

        return yield* Effect.forEach(messages, sendOne, {
          concurrency: batchConcurrency,
        });
      },
      (effect, messages) =>
        effect.pipe(
          Effect.annotateLogs({
            provider: providerName,
            category: messages[0]?.tags?.[0],
            size: messages.length,
          })
        )
    ),
  };
};

/** One message in PostHog's code-mode request body. */
interface PostHogEmail {
  readonly to: string;
  readonly template_key: string;
  readonly subject: string;
  readonly html?: string;
  readonly text?: string;
  readonly from: string;
  readonly reply_to?: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly distinct_id: string;
  readonly capture_engagement: true;
}

/** A message PostHog can carry: one recipient and at least one body. */
type CarriedMessage = RoutedEmailMessage & {
  readonly to: EmailRecipient;
};

const addressList = (
  recipients: EmailRecipient | EmailRecipient[] | undefined
) =>
  recipients === undefined
    ? []
    : (Array.isArray(recipients) ? recipients : [recipients]).map(
        (recipient) => recipient.email
      );

/**
 * Refuses, before any request, a message PostHog cannot send. Attachments are
 * refused for every provider (marketing mail has none; the transactional
 * stream never reaches PostHog). Recipient lists PostHog cannot carry go to
 * the next provider, which can.
 */
const refuseUncarriable = (message: RoutedEmailMessage) => {
  if (message.attachments?.length) {
    return Effect.fail(
      emailServiceFailure(
        "PostHog email cannot carry attachments",
        providerName,
        {
          failureKind: "message",
          code: "attachments_unsupported",
        }
      )
    );
  }
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  const [recipient] = recipients;
  if (
    recipients.length !== 1 ||
    recipient === undefined ||
    addressList(message.cc).length > maxListedAddresses ||
    addressList(message.bcc).length > maxListedAddresses
  ) {
    return Effect.fail(
      emailServiceFailure(
        "PostHog email takes one recipient and up to ten copies",
        providerName,
        { failureKind: "provider", code: "recipients_unsupported" }
      )
    );
  }
  if (message.html === undefined && message.text === undefined) {
    return Effect.fail(
      emailServiceFailure("The email has no content", providerName, {
        failureKind: "message",
        code: "missing_content",
      })
    );
  }
  return Effect.succeed<CarriedMessage>({ ...message, to: recipient });
};

const toPostHogEmail = (
  message: CarriedMessage,
  config: PostHogEmailProviderConfig
): PostHogEmail => {
  const cc = addressList(message.cc);
  const bcc = addressList(message.bcc);
  return {
    to: message.to.email,
    template_key: templateKey(message.tags?.[0]),
    subject: message.subject,
    ...(message.html !== undefined && { html: message.html }),
    ...(message.text !== undefined && { text: message.text }),
    from: config.from ?? formatSender(message.from),
    ...(message.replyTo && { reply_to: [message.replyTo.email] }),
    ...(cc.length > 0 && { cc }),
    ...(bcc.length > 0 && { bcc }),
    distinct_id: message.recipientIdentity?.trim() || config.systemIdentity,
    capture_engagement: true,
  };
};

/** The message category as a PostHog template key, which groups its metrics. */
const templateKey = (category: string | undefined) =>
  category?.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, maxTemplateKeyLength) ||
  "email";

const formatSender = (sender: EmailRecipient) =>
  sender.name ? `${sender.name} <${sender.email}>` : sender.email;

/**
 * The PostHog idempotency key of a message: its own key when PostHog can carry
 * it, a SHA-256 digest of one it cannot, or a fresh key when it has none. The
 * digest and fresh keys are prefixed so they never equal a caller's key.
 */
const messageIdempotencyKey = (key: string | undefined) =>
  key === undefined
    ? Effect.sync(() => `deskohub-generated:${randomUUID()}`)
    : Effect.succeed(
        idempotencyKeyPattern.test(key)
          ? key
          : `deskohub-sha256:${createHash("sha256").update(key).digest("hex")}`
      );

/** How one HTTP attempt of a send failed, before the retries are spent. */
class PostHogSendAttemptFailure extends Data.TaggedError(
  "PostHogSendAttemptFailure"
)<{
  readonly kind: "transport" | "timeout" | "answered";
  readonly status?: number;
  readonly code: string;
  readonly retryAfter?: Duration.Duration;
}> {}

/** Throttling, an in-flight key, and outages pass; quota and refusals do not. */
const isRetryableAttempt = (failure: PostHogSendAttemptFailure) =>
  failure.kind !== "answered" ||
  (failure.status === 429 && failure.code !== "quota_limited") ||
  (failure.status === 409 && failure.code === "idempotency_key_in_flight") ||
  (failure.status !== undefined && failure.status >= 500);

const SendAnswerSchema = Schema.Struct({ message_id: EmailDeliveryIdSchema });

const requestSend = ({
  config,
  email,
  idempotencyKey,
  maxRetryAfter,
}: {
  readonly config: PostHogEmailProviderConfig;
  readonly email: PostHogEmail;
  readonly idempotencyKey: string;
  readonly maxRetryAfter: Duration.Duration;
}) =>
  Effect.gen(function* () {
    const policy = postHogEmailRetryPolicy.withAttemptTimeout(
      yield* postHogEmailAttemptTimeout(config)
    );
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(
      `${postHogAppHost(config.host)}${sendPath}`
    ).pipe(
      HttpClientRequest.bearerToken(Redacted.value(config.secretKey)),
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeader("Idempotency-Key", idempotencyKey),
      HttpClientRequest.bodyJsonUnsafe(email)
    );

    const attempt = httpClient.execute(request).pipe(
      Effect.mapError(
        () =>
          new PostHogSendAttemptFailure({
            kind: "transport",
            code: "network_error",
          })
      ),
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.succeed(response)
          : Effect.gen(function* () {
              return yield* new PostHogSendAttemptFailure({
                kind: "answered",
                status: response.status,
                code: yield* postHogFailureCode(response),
                retryAfter: yield* readRetryAfter(response),
              });
            })
      ),
      policy.attempt(
        () =>
          new PostHogSendAttemptFailure({ kind: "timeout", code: "timeout" })
      )
    );

    const response = yield* attempt.pipe(
      policy.retryWhileHonoringDelay(isRetryableAttempt, {
        requestedDelay: (failure) => failure.retryAfter,
        maxRequestedDelay: maxRetryAfter,
      }),
      Effect.mapError(toEmailSendError)
    );

    const answer = yield* response.text.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.fromJsonString(SendAnswerSchema))
      ),
      Effect.mapError(() =>
        networkFailure({
          message: "PostHog accepted the email without a readable message id",
          code: "invalid_response",
          failureKind: "unknown-outcome",
        })
      )
    );

    const result: EmailSendResult = {
      id: answer.message_id,
      status: "queued",
      provider: providerName,
      timestamp: new Date(yield* Clock.currentTimeMillis),
    };
    return result;
  }).pipe(Effect.provide(FetchHttpClient.layer));

/** PostHog answer codes that mean the project cannot send, not the message. */
const projectRefusalCodes: ReadonlySet<string> = new Set([
  "transactional_email_paused",
  "sender_unavailable",
  "sending_paused",
  "sending_suspended",
]);

/**
 * The provider chain's view of a send whose retries are spent: the next
 * provider may send it ("provider"), no provider may ("message"), or PostHog
 * may still deliver it ("unknown-outcome": the caller replays under the same
 * key later).
 */
const toEmailSendError = (
  failure: PostHogSendAttemptFailure
): ClassifiedEmailSendError =>
  Match.value(failure).pipe(
    Match.when({ kind: "transport" }, ({ code }) =>
      networkFailure({
        message: "PostHog email request failed",
        code,
        failureKind: "provider",
      })
    ),
    Match.when({ kind: "timeout" }, ({ code }) =>
      networkFailure({
        message: "PostHog email request timed out",
        code,
        failureKind: "provider",
      })
    ),
    Match.when({ kind: "answered" }, ({ status = 0, code }) => {
      if (status === 409 && code === "idempotency_key_in_flight") {
        return networkFailure({
          message: "PostHog is still sending an email under this key",
          code,
          failureKind: "unknown-outcome",
        });
      }
      const failureKind =
        status < 400 ||
        status >= 500 ||
        [401, 403, 404, 429].includes(status) ||
        projectRefusalCodes.has(code)
          ? "provider"
          : "message";
      return emailServiceFailure(
        `PostHog refused the email (HTTP ${status})`,
        providerName,
        { failureKind, code }
      );
    }),
    Match.exhaustive
  );

/** Whether `error` means PostHog cannot send now, so the batch stops. */
const failsProvider = (error: ClassifiedEmailSendError) =>
  error.failureKind === "provider";

const notAttempted = () =>
  emailServiceFailure(
    "PostHog stopped sending this batch after a provider failure",
    providerName,
    { failureKind: "provider", code: "not_attempted" }
  );

const pastDeadline = () =>
  emailServiceFailure("The PostHog batch deadline passed", providerName, {
    failureKind: "provider",
    code: "batch_deadline",
  });

const abandonedAtDeadline = () =>
  networkFailure({
    message: "PostHog email send was abandoned at the batch deadline",
    code: "batch_deadline",
    failureKind: "unknown-outcome",
  });

const failedResult = (error: () => ClassifiedEmailSendError) =>
  Effect.map(
    Clock.currentTimeMillis,
    (now): EmailSendFailure => ({
      status: "failed",
      provider: providerName,
      timestamp: new Date(now),
      error: error(),
    })
  );

const logSendFailure = (error: ClassifiedEmailSendError) =>
  Effect.logWarning("PostHog email send failed", {
    errorType: error._tag,
    failureKind: error.failureKind,
    code: error.code,
  });

/** PostHog accepts no custom headers, so List-Unsubscribe and others are dropped. */
const logDroppedHeaders = (messages: readonly RoutedEmailMessage[]) => {
  const names = new Set(
    messages.flatMap((message) => Object.keys(message.headers ?? {}))
  );
  return Effect.when(
    Effect.logInfo("PostHog email drops custom headers", {
      headers: [...names].sort(),
    }),
    Effect.succeed(names.size > 0)
  ).pipe(Effect.asVoid);
};
