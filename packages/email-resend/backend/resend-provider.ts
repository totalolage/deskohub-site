import type { ProviderRequestPolicy } from "@deskohub/provider-request";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailProvider,
  type EmailSendError,
  type EmailSendResult,
  EmailServiceError,
  NetworkError,
} from "@deskohub/email";
import { createHash } from "node:crypto";
import { Config, Duration, Effect, Option, Schema } from "effect";
import { Resend } from "resend";
import { resendRetryPolicy } from "./request-policy";

const resendTagPattern = /^[A-Za-z0-9_-]{1,256}$/;

export type ResendRequestTimeouts = {
  readonly send: Duration.Duration;
  readonly batch: Duration.Duration;
};

/**
 * Production fails a slow Resend request fast; a batch carries up to 100
 * rendered emails, so its upload gets a little longer. Preview, development,
 * CI, and E2E deployments share Resend capacity with parallel runs, so they
 * wait much longer before giving up.
 */
export const resendRequestTimeouts = {
  production: { send: Duration.seconds(5), batch: Duration.seconds(10) },
  nonProduction: { send: Duration.seconds(30), batch: Duration.seconds(30) },
} as const satisfies Record<string, ResendRequestTimeouts>;

/** The Resend request timeouts of the deployment `VERCEL_ENV` names. */
export const deploymentResendRequestTimeouts = Effect.gen(function* () {
  const environment = yield* Config.option(Config.string("VERCEL_ENV"));
  return Option.contains(environment, "production")
    ? resendRequestTimeouts.production
    : resendRequestTimeouts.nonProduction;
}).pipe(Effect.orDie);

type ResendTag = { name: string; value: string };

/** The message's categories Resend can carry, each as a `category` tag. */
const toResendCategoryTags = (categories: EmailMessage["tags"]) =>
  (categories ?? [])
    .filter((category) => resendTagPattern.test(category))
    .map((category): ResendTag => ({ name: "category", value: category }));

/** The message's string metadata whose name and value Resend can carry. */
const toResendMetadataTags = (metadata: EmailMessage["metadata"]) => {
  const tags: ResendTag[] = [];
  for (const [name, value] of Object.entries(metadata ?? {})) {
    if (typeof value !== "string") continue;
    if (!resendTagPattern.test(name) || !resendTagPattern.test(value)) continue;
    tags.push({ name, value });
  }
  return tags;
};

const toResendTags = (message: EmailMessage) => {
  const tags = [
    ...toResendCategoryTags(message.tags),
    ...toResendMetadataTags(message.metadata),
  ];

  return tags.length > 0 ? tags : undefined;
};

const getResendErrorMessage = (error: unknown) => {
  if (!error || typeof error !== "object") return "Unknown Resend error";

  const message = "message" in error ? error.message : undefined;
  if (typeof message === "string") return message;

  const code = "error" in error ? error.error : undefined;
  return typeof code === "string" ? code : "Unknown Resend error";
};

const getResendErrorStatusCode = (error: unknown) => {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return undefined;
  }

  return typeof error.statusCode === "number" ? error.statusCode : undefined;
};

type ResendResponse<A> = {
  readonly data: A | null;
  readonly error: unknown;
};

const resendProviderRefusal = (code: string) =>
  new EmailServiceError("Resend cannot send now", undefined, "resend", {
    failureKind: "provider",
    code,
  });

const resendMessageRefusal = (code: string) =>
  new EmailServiceError(
    "Resend rejected the email request",
    undefined,
    "resend",
    {
      failureKind: "message",
      code,
    }
  );

/**
 * Classifies a Resend refusal by its HTTP status:
 *
 * | Status | Error | Chain | Send retry |
 * |---|---|---|---|
 * | 429 quota or rate limit | `EmailServiceError` `provider` | next provider | no |
 * | 401, 403, 404 key, scope, or missing resource | `EmailServiceError` `provider` | next provider | no |
 * | 409 idempotency key in use or reused | `NetworkError` `unknown-outcome` | stops; caller replays | yes |
 * | other 4xx, such as 400 and 422 validation | `EmailServiceError` `message` | stops | no |
 * | 5xx | `NetworkError` `provider` | next provider | yes |
 *
 * An error without a status is classified by its message: an
 * authentication or unverified-domain refusal is provider-level, any other
 * invalid or bad request is message-level, and the rest is a server failure.
 * Codes are `http-<status>` or `resend-<kind>`; the raw provider message is
 * discarded so spans and logs never carry it.
 */
const classifyResendError = (error: unknown): EmailSendError => {
  const statusCode = getResendErrorStatusCode(error);
  if (statusCode === undefined) {
    const message = getResendErrorMessage(error).toLowerCase();
    if (
      ["unauthorized", "forbidden", "api key", "not verified"].some((word) =>
        message.includes(word)
      )
    ) {
      return resendProviderRefusal("resend-unauthorized");
    }
    if (message.includes("invalid") || message.includes("bad request")) {
      return resendMessageRefusal("resend-invalid");
    }
    return new NetworkError({
      message: "Resend network error",
      code: "resend-server",
    });
  }
  const code = `http-${statusCode}`;
  if (statusCode === 409) {
    return new NetworkError({
      message: "Resend idempotency key already in use",
      code,
      failureKind: "unknown-outcome",
    });
  }
  if (statusCode >= 500 || statusCode < 400) {
    return new NetworkError({ message: "Resend network error", code });
  }
  return [401, 403, 404, 429].includes(statusCode)
    ? resendProviderRefusal(code)
    : resendMessageRefusal(code);
};

/**
 * Runs one Resend request. The request gets Effect's abort signal, so a
 * timeout or interrupt cancels it in flight instead of leaving it to overlap
 * a later attempt. A transport failure or timeout is a `NetworkError`; a
 * refusal is classified by `classifyResendError`.
 */
const requestResend = <A>(
  request: (signal: AbortSignal) => Promise<ResendResponse<A>>,
  policy: ProviderRequestPolicy
) =>
  Effect.tryPromise({
    try: (signal) => request(signal),
    // Discard the raw transport failure; its message may carry request data.
    catch: () =>
      new NetworkError({ message: "Resend request failed", code: "transport" }),
  }).pipe(
    policy.attempt(
      () =>
        new NetworkError({ message: "Resend send timed out", code: "timeout" })
    ),
    Effect.flatMap(
      (response): Effect.Effect<A | null, EmailSendError> =>
        response.error
          ? Effect.fail(classifyResendError(response.error))
          : Effect.succeed(response.data)
    ),
    Effect.tapError((error) =>
      Effect.logWarning("Resend request failed", {
        errorTag: error._tag,
        errorCode: error.code,
      })
    )
  );

const isRetryableResendFailure = (error: EmailSendError) =>
  error._tag === "NetworkError";

const isUnknownOutcome = (error: EmailSendError) =>
  error._tag === "NetworkError" && error.failureKind === "unknown-outcome";

const toResendEmail = (message: EmailMessage) => ({
  from: `${message.from.name || ""} <${message.from.email}>`.trim(),
  to: Array.isArray(message.to)
    ? message.to.map((r) => r.email)
    : [message.to.email],
  subject: message.subject,
  html: message.html,
  text: message.text || "",
  replyTo: message.replyTo?.email,
  headers: message.headers,
  tags: toResendTags(message),
});

/**
 * Resend accepted the request but its response is unreadable, so whether it
 * delivered is unknown.
 */
const decodeDeliveryId = (id: unknown) =>
  Schema.decodeUnknownEffect(EmailDeliveryIdSchema)(id).pipe(
    Effect.mapError(
      () =>
        new NetworkError({
          message: "Resend response did not contain a valid email delivery ID",
          code: "invalid-response",
          failureKind: "unknown-outcome",
        })
    )
  );

export interface ResendEmailProviderConfig {
  readonly apiKey: string;
  readonly timeouts: ResendRequestTimeouts;
}

/**
 * Sends through Resend. A single send retries a transport failure, a server
 * failure, or a 409 under its idempotency key, with a jittered exponential
 * backoff from 1 second, at most three times; a batch runs once, and only
 * its caller can replay it safely. Resend cannot carry attachments in a
 * batch, so such a batch is refused at the message level before any
 * request.
 */
export const makeResendEmailProvider = ({
  apiKey,
  timeouts,
}: ResendEmailProviderConfig): EmailProvider => {
  const resend = new Resend(apiKey);
  const sendPolicy = resendRetryPolicy.withAttemptTimeout(timeouts.send);
  const batchPolicy = resendRetryPolicy.withAttemptTimeout(timeouts.batch);

  return {
    name: "resend",

    send: Effect.fn("resend.send")(
      function* (message: EmailMessage) {
        yield* Effect.logInfo("Sending email via Resend", {
          category: message.tags?.[0],
          hasHtml: !!message.html,
          hasText: !!message.text,
        });

        // Once an attempt may have delivered, the send stays uncertain
        // unless a later attempt succeeds.
        let uncertain = false;
        const deliveryId = yield* requestResend(
          (signal) =>
            resend.emails.send(
              {
                ...toResendEmail(message),
                attachments: message.attachments?.map((attachment) => ({
                  content: attachment.content,
                  contentId: attachment.contentId,
                  contentType: attachment.contentType,
                  filename: attachment.filename,
                })),
              },
              {
                idempotencyKey: getResendIdempotencyKey(message.idempotencyKey),
                signal,
              }
            ),
          sendPolicy
        ).pipe(
          Effect.tap((response) =>
            Effect.logInfo("Resend request succeeded", {
              hasData: !!response,
              id: response?.id,
            })
          ),
          Effect.flatMap((response) => decodeDeliveryId(response?.id)),
          Effect.tapError((error) =>
            Effect.sync(() => {
              uncertain ||= isUnknownOutcome(error);
            })
          ),
          sendPolicy.retryWhile(isRetryableResendFailure),
          Effect.mapError((error) =>
            uncertain && !isUnknownOutcome(error)
              ? new NetworkError({
                  message: "An earlier Resend attempt may have delivered",
                  code: error.code,
                  failureKind: "unknown-outcome",
                })
              : error
          )
        );

        const sendResult: EmailSendResult = {
          id: deliveryId,
          status: "sent",
          provider: "resend",
          timestamp: new Date(),
        };

        yield* Effect.annotateLogsScoped({ result: sendResult });
        yield* Effect.logInfo("Email sent successfully via Resend", {
          id: deliveryId,
        });

        return sendResult;
      },
      (effect, message) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({
            provider: "resend",
            category: message.tags?.[0],
            hasHtml: !!message.html,
            hasText: !!message.text,
          })
        )
    ),

    sendBatch: Effect.fn("resend.sendBatch")(
      function* (messages, options) {
        if (messages.some((message) => message.attachments?.length)) {
          return yield* resendMessageRefusal("attachments-unsupported");
        }
        yield* Effect.logInfo("Sending email batch via Resend", {
          category: messages[0]?.tags?.[0],
          size: messages.length,
        });

        const data = yield* requestResend(
          (signal) =>
            resend.batch.send(messages.map(toResendEmail), {
              idempotencyKey: getResendIdempotencyKey(options.idempotencyKey),
              signal,
            }),
          batchPolicy
        );

        const ids = data?.data ?? [];
        if (ids.length !== messages.length) {
          return yield* new NetworkError({
            message: "Resend batch response did not match the batch size",
            code: "batch-size-mismatch",
            failureKind: "unknown-outcome",
          });
        }

        const timestamp = new Date();
        return yield* Effect.forEach(ids, ({ id }) =>
          decodeDeliveryId(id).pipe(
            Effect.map(
              (deliveryId): EmailSendResult => ({
                id: deliveryId,
                status: "sent",
                provider: "resend",
                timestamp,
              })
            )
          )
        );
      },
      (effect, messages) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({
            provider: "resend",
            category: messages[0]?.tags?.[0],
            size: messages.length,
          })
        )
    ),
  };
};

const resendIdempotencyKeyMaxLength = 256;

/**
 * A key longer than Resend accepts becomes its SHA-256 digest, so keys that
 * differ only past the limit, such as a provider chain's fallback and route
 * suffixes, stay distinct.
 */
const getResendIdempotencyKey = (idempotencyKey: string | undefined) =>
  idempotencyKey === undefined ||
  idempotencyKey.length <= resendIdempotencyKeyMaxLength
    ? idempotencyKey
    : `sha256-${createHash("sha256").update(idempotencyKey).digest("hex")}`;
