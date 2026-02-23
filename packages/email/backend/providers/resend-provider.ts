import { Config, Context, Effect, Layer } from "effect";
import { Resend } from "resend";
import { NetworkError } from "@/shared/backend/errors";
import type { EmailMessage, EmailSendResult } from "../../types/email.types";
import {
  type EmailProvider,
  EmailProviderTag,
  EmailServiceError,
} from "../service";

interface ResendConfig {
  apiKey: string;
}

class ResendConfigTag extends Context.Tag("ResendConfig")<
  ResendConfigTag,
  ResendConfig
>() {}

const ResendConfigLayer = Layer.effect(
  ResendConfigTag,
  Effect.gen(function* () {
    const apiKey = yield* Config.string("EMAIL_API_KEY").pipe(
      Config.withDefault("")
    );

    if (!apiKey) {
      yield* Effect.logWarning("Resend API key not configured");
    }

    return { apiKey } satisfies ResendConfig;
  })
);

const createResendProvider = (config: ResendConfig): EmailProvider => {
  const resend = new Resend(config.apiKey);

  return {
    name: "resend",

    send: (message: EmailMessage) =>
      Effect.gen(function* () {
        yield* Effect.logInfo("Sending email via Resend", {
          to: message.to,
          subject: message.subject,
          from: message.from,
        });

        const result = yield* Effect.tryPromise({
          try: async () => {
            const fromAddress =
              typeof message.from === "string"
                ? message.from
                : `${message.from.name || ""} <${message.from.email}>`.trim();

            const toAddresses =
              typeof message.to === "string"
                ? [message.to]
                : Array.isArray(message.to)
                  ? message.to.map((r) => r.email)
                  : [message.to.email];

            const response = await resend.emails.send({
              from: fromAddress,
              to: toAddresses,
              subject: message.subject,
              html: message.html,
              text: message.text || "",
              replyTo: message.replyTo
                ? typeof message.replyTo === "string"
                  ? message.replyTo
                  : message.replyTo.email
                : undefined,
            });

            if (response.error) {
              const resendError = response.error as {
                statusCode?: number;
                message?: string;
                error?: string;
                name?: string;
              };
              const errorMessage =
                resendError.message ||
                resendError.error ||
                "Unknown Resend error";
              const normalizedErrorMessage = errorMessage.toLowerCase();

              if (
                (resendError.statusCode !== undefined &&
                  resendError.statusCode >= 400 &&
                  resendError.statusCode < 500) ||
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
            Effect.logInfo("Resend tryPromise succeeded", {
              hasData: !!response.data,
              id: response.data?.id,
            })
          ),
          Effect.tapError((error) =>
            Effect.logWarning(
              "Resend tryPromise failed - will retry if NetworkError",
              {
                errorTag: error._tag,
                errorMessage: error.message,
                willRetry: error._tag === "NetworkError",
              }
            )
          )
        );

        yield* Effect.logInfo("Email sent successfully via Resend", {
          id: result.data?.id,
          response: result,
        });

        return {
          id: result.data?.id || `resend-${Date.now()}`,
          provider: "resend",
          timestamp: new Date(),
        } as EmailSendResult;
      }),

    verify: () =>
      Effect.gen(function* () {
        return yield* Effect.tryPromise({
          try: async () => {
            await resend.domains.list();
            return true;
          },
          catch: (error) => {
            return new EmailServiceError(
              "Failed to verify Resend API key",
              error
            );
          },
        }).pipe(
          Effect.tap((success) =>
            success
              ? Effect.logInfo("Resend API key verified successfully")
              : Effect.logWarning("Resend API key verification failed")
          )
        );
      }),
  };
};

export const ResendEmailProviderLive = Layer.effect(
  EmailProviderTag,
  Effect.gen(function* () {
    const config = yield* ResendConfigTag;
    return createResendProvider(config);
  })
).pipe(Layer.provide(ResendConfigLayer));
