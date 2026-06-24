import { Effect, Layer } from "effect";
import { Resend } from "resend";
import type { EmailMessage, EmailSendResult } from "../../types/email.types";
import { NetworkError } from "../network-error";
import {
  EmailConfigTag,
  type EmailProvider,
  EmailProviderTag,
  EmailServiceError,
  isRetryableEmailError,
} from "../service";

const resendTagPattern = /^[A-Za-z0-9_-]{1,256}$/;

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

const createResendProvider = (apiKey: string): EmailProvider => {
  const resend = new Resend(apiKey);

  return {
    name: "resend",

    send: Effect.fn("resend.send")(
      function* (message: EmailMessage) {
        yield* Effect.annotateLogsScoped({ message });
        yield* Effect.logInfo("Sending email via Resend", {
          to: message.to,
          subject: message.subject,
          from: message.from,
        });

        const result = yield* Effect.tryPromise({
          try: async () => {
            const fromAddress =
              `${message.from.name || ""} <${message.from.email}>`.trim();

            const toAddresses = Array.isArray(message.to)
              ? message.to.map((r) => r.email)
              : [message.to.email];

            const response = await resend.emails.send({
              from: fromAddress,
              to: toAddresses,
              subject: message.subject,
              html: message.html,
              text: message.text || "",
              attachments: message.attachments?.map((attachment) => ({
                content: attachment.content,
                contentId: attachment.contentId,
                contentType: attachment.contentType,
                filename: attachment.filename,
              })),
              replyTo: message.replyTo?.email,
              headers: message.headers,
              tags: toResendTags(message),
            });

            const resendError = response.error;
            if (resendError) {
              const errorMessage = getResendErrorMessage(resendError);
              const statusCode = getResendErrorStatusCode(resendError);
              const normalizedErrorMessage = errorMessage.toLowerCase();

              if (
                (statusCode !== undefined &&
                  statusCode >= 400 &&
                  statusCode < 500) ||
                normalizedErrorMessage.includes("invalid") ||
                normalizedErrorMessage.includes("bad request") ||
                normalizedErrorMessage.includes("unauthorized") ||
                normalizedErrorMessage.includes("forbidden") ||
                normalizedErrorMessage.includes("not verified")
              ) {
                throw new Error(`CLIENT_ERROR: ${errorMessage}`);
              }

              throw new Error(`API_ERROR: ${errorMessage}`);
            }

            return response;
          },
          catch: (error) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            const normalizedErrorMessage = errorMessage.toLowerCase();

            if (errorMessage.includes("CLIENT_ERROR:")) {
              return new EmailServiceError(
                errorMessage.replace("CLIENT_ERROR: ", ""),
                error,
                "resend"
              );
            }

            if (
              errorMessage.includes("API_ERROR:") ||
              normalizedErrorMessage.includes("econnrefused") ||
              normalizedErrorMessage.includes("etimedout") ||
              normalizedErrorMessage.includes("enotfound") ||
              normalizedErrorMessage.includes("network")
            ) {
              return new NetworkError({
                message: "Resend network error",
                cause: error,
              });
            }

            return new EmailServiceError(
              `Resend error: ${errorMessage}`,
              error,
              "resend"
            );
          },
        }).pipe(
          Effect.tap((response) =>
            Effect.gen(function* () {
              yield* Effect.annotateLogsScoped({ response });
              yield* Effect.logDebug("Resend provider response received", {
                response,
              });
              yield* Effect.logInfo("Resend tryPromise succeeded", {
                hasData: !!response.data,
                id: response.data?.id,
              });
            })
          ),
          Effect.tapError((error) =>
            Effect.logWarning(
              "Resend tryPromise failed - will retry if NetworkError",
              {
                errorTag: error._tag,
                errorMessage: error.message,
                willRetry: isRetryableEmailError(error),
              }
            )
          )
        );

        const sendResult = {
          id: result.data?.id || `resend-${Date.now()}`,
          status: "sent",
          provider: "resend",
          timestamp: new Date(),
        } satisfies EmailSendResult;

        yield* Effect.annotateLogsScoped({ result: sendResult });
        yield* Effect.logDebug("Resend email send result created", {
          result: sendResult,
        });
        yield* Effect.logInfo("Email sent successfully via Resend", {
          id: result.data?.id,
          response: result,
        });

        return sendResult;
      },
      (effect, message) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({ provider: "resend", message })
        )
    ),

    verify: Effect.fn("resend.verify")(
      function* () {
        yield* Effect.logInfo("Resend API key verification started");

        return yield* Effect.tryPromise({
          try: async () => {
            return await resend.domains.list();
          },
          catch: (error) => {
            return new EmailServiceError(
              "Failed to verify Resend API key",
              error
            );
          },
        }).pipe(
          Effect.tap((response) =>
            Effect.gen(function* () {
              yield* Effect.annotateLogsScoped({ response });
              yield* Effect.logDebug(
                "Resend verify provider response received",
                {
                  response,
                }
              );
            })
          ),
          Effect.flatMap((response) => {
            const resendError = response.error;
            if (!resendError) return Effect.succeed(true);

            return Effect.fail(
              new EmailServiceError(
                `Failed to verify Resend API key: ${getResendErrorMessage(resendError)}`,
                resendError,
                "resend"
              )
            );
          }),
          Effect.tap((success) =>
            Effect.gen(function* () {
              yield* Effect.annotateLogsScoped({ result: success });
              yield* Effect.logInfo("Resend API key verified successfully");
            })
          ),
          Effect.tapError((error) =>
            Effect.logError("Resend API key verification failed", {
              errorType: error._tag,
              errorMessage: error.message,
            })
          )
        );
      },
      (effect) =>
        effect.pipe(Effect.scoped, Effect.annotateLogs({ provider: "resend" }))
    ),
  };
};

export const ResendEmailProviderLive = Layer.effect(
  EmailProviderTag,
  Effect.gen(function* () {
    const config = yield* EmailConfigTag;
    const apiKey = config.apiKey?.trim() ?? "";

    if (!apiKey) {
      return yield* Effect.fail(
        new EmailServiceError(
          "EMAIL_API_KEY is required for Resend email provider",
          undefined,
          "resend"
        )
      );
    }

    return createResendProvider(apiKey);
  })
);
