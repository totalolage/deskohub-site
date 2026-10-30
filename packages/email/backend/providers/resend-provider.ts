import { Config, Duration, Effect, Layer, Option, Schema } from "effect";
import { Resend } from "resend";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendResult,
} from "../../types/email.types";
import {
  EmailConfigTag,
  type EmailProvider,
  EmailProviderTag,
  EmailServiceError,
  isRetryableEmailError,
} from "../capabilities";
import { NetworkError } from "../network-error";

const resendTagPattern = /^[A-Za-z0-9_-]{1,256}$/;

type ResendRequestTimeouts = {
  readonly send: Duration.Duration;
  readonly batch: Duration.Duration;
};

/**
 * Production fails a slow Resend request fast; a batch carries up to 100
 * rendered emails, so its upload gets a little longer. Preview, development,
 * CI, and E2E deployments share Resend capacity with parallel runs, so they
 * wait much longer before giving up.
 */
const resendRequestTimeouts = {
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

const toResendTags = (message: EmailMessage) => {
  const tags: { name: string; value: string }[] = [];

  for (const tag of message.tags ?? []) {
    if (resendTagPattern.test(tag)) {
      tags.push({ name: "category", value: tag });
    }
  }

  for (const [name, value] of Object.entries(message.metadata ?? {})) {
    if (typeof value !== "string") continue;
    if (!resendTagPattern.test(name) || !resendTagPattern.test(value)) continue;
    tags.push({ name, value });
  }

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

/**
 * Resend refused a request with this status and sent nothing. A 409 means
 * the idempotency key was already used, so an earlier request under it may
 * have been delivered.
 */
const isResendRefusal = (statusCode: number) =>
  statusCode >= 400 && statusCode < 500 && statusCode !== 409;

/**
 * Runs one Resend request and classifies its failure. `EmailServiceError`
 * means Resend refused the request and sent nothing. `NetworkError` means
 * the outcome is unknown (a timeout, a transport or server failure, a reused
 * key, or an unreadable response to an accepted request), so the caller may
 * retry under the same idempotency key. The raw provider failure is
 * discarded so spans and logs never carry its message. The request gets
 * Effect's abort signal, so a timeout or interrupt cancels it in flight
 * instead of leaving it to overlap a later attempt.
 */
const requestResend = <A>(
  request: (signal: AbortSignal) => Promise<ResendResponse<A>>,
  timeout: Duration.Input
) =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await request(signal);
      const resendError = response.error;
      if (resendError) {
        const errorMessage = getResendErrorMessage(resendError);
        const statusCode = getResendErrorStatusCode(resendError);
        const normalizedErrorMessage = errorMessage.toLowerCase();

        if (
          statusCode === undefined
            ? normalizedErrorMessage.includes("invalid") ||
              normalizedErrorMessage.includes("bad request") ||
              normalizedErrorMessage.includes("unauthorized") ||
              normalizedErrorMessage.includes("forbidden") ||
              normalizedErrorMessage.includes("not verified")
            : isResendRefusal(statusCode)
        ) {
          throw new Error(`CLIENT_ERROR: ${errorMessage}`);
        }

        throw new Error(`API_ERROR: ${errorMessage}`);
      }

      return response.data;
    },
    catch: (error) => {
      // Classify internally, then discard the raw provider failure.
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("CLIENT_ERROR:")) {
        return new EmailServiceError(
          "Resend rejected the email request",
          undefined,
          "resend"
        );
      }

      return new NetworkError({
        message: errorMessage.includes("API_ERROR:")
          ? "Resend network error"
          : "Resend request failed",
      });
    },
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new NetworkError({
            message: "Resend send timed out",
          })
        ),
    }),
    Effect.tapError((error) =>
      Effect.logWarning(
        "Resend tryPromise failed - will retry if NetworkError",
        {
          errorTag: error._tag,
          willRetry: isRetryableEmailError(error),
        }
      )
    )
  );

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
        })
    )
  );

export const createResendProvider = (
  apiKey: string,
  timeouts: ResendRequestTimeouts
): EmailProvider => {
  const resend = new Resend(apiKey);

  return {
    name: "resend",

    send: Effect.fn("resend.send")(
      function* (message: EmailMessage) {
        yield* Effect.logInfo("Sending email via Resend", {
          category: message.tags?.[0],
          hasHtml: !!message.html,
          hasText: !!message.text,
        });

        const data = yield* requestResend(
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
          timeouts.send
        ).pipe(
          Effect.tap((response) =>
            Effect.logInfo("Resend tryPromise succeeded", {
              hasData: !!response,
              id: response?.id,
            })
          )
        );

        const deliveryId = yield* decodeDeliveryId(data?.id);

        const sendResult: EmailSendResult = {
          id: deliveryId,
          status: "sent",
          provider: "resend",
          timestamp: new Date(),
        };

        yield* Effect.annotateLogsScoped({ result: sendResult });
        yield* Effect.logInfo("Email sent successfully via Resend", {
          id: data?.id,
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
          return yield* new EmailServiceError(
            "Resend batch emails cannot carry attachments",
            undefined,
            "resend"
          );
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
          timeouts.batch
        );

        const ids = data?.data ?? [];
        if (ids.length !== messages.length) {
          return yield* new NetworkError({
            message: "Resend batch response did not match the batch size",
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

const getResendIdempotencyKey = (idempotencyKey: string | undefined) =>
  idempotencyKey?.slice(0, resendIdempotencyKeyMaxLength);

export const ResendEmailProviderLive = Layer.effect(
  EmailProviderTag,
  Effect.gen(function* () {
    const config = yield* EmailConfigTag;
    const apiKey = config.apiKey?.trim() ?? "";

    if (!apiKey) {
      return yield* new EmailServiceError(
        "EMAIL_API_KEY is required for Resend email provider",
        undefined,
        "resend"
      );
    }

    return createResendProvider(apiKey, yield* deploymentResendRequestTimeouts);
  })
);
