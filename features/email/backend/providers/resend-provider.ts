import { Config, Context, Effect, Layer } from "effect";
import { Resend } from "resend";
import {
  type EmailProvider,
  EmailProviderTag,
  EmailServiceError,
} from "@/features/email/backend/service";
import type {
  EmailMessage,
  EmailSendResult,
} from "@/features/email/types/email.types";
import { NetworkError } from "@/shared/backend/errors";

interface ResendConfig {
  apiKey: string;
}

/**
 * Resend Config Tag for dependency injection
 */
class ResendConfigTag extends Context.Tag("ResendConfig")<
  ResendConfigTag,
  ResendConfig
>() {}

const ResendConfigLayer = Layer.effect(
  ResendConfigTag,
  Effect.gen(function* () {
    const apiKey = yield* Config.string("RESEND_API_KEY").pipe(
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
        try {
          yield* Effect.logInfo("Sending email via Resend", {
            to: message.to,
            subject: message.subject,
            from: message.from,
          });

          const result = yield* Effect.tryPromise({
            try: async () => {
              // Attempting to send via Resend API
              const fromAddress =
                typeof message.from === "string"
                  ? message.from
                  : `${message.from.name || ""} <${message.from.email}>`.trim();

              // Sending from configured address

              const toAddresses =
                typeof message.to === "string"
                  ? [message.to]
                  : Array.isArray(message.to)
                    ? message.to.map((r) => r.email)
                    : [message.to.email];

              // Preparing email for recipients

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
                const { error: errorMessage, statusCode } =
                  response.error as unknown as {
                    statusCode: number;
                    error: string;
                  }; // Resend sdk lies about the error type

                // Check if it's a client error (4xx) that shouldn't be retried
                if (
                  (statusCode >= 400 && statusCode < 500) ||
                  errorMessage.toLowerCase().includes("invalid") ||
                  errorMessage.toLowerCase().includes("bad request") ||
                  errorMessage.toLowerCase().includes("unauthorized") ||
                  errorMessage.toLowerCase().includes("forbidden") ||
                  errorMessage.toLowerCase().includes("not verified")
                ) {
                  throw new Error(`CLIENT_ERROR: ${errorMessage}`);
                } else {
                  throw new Error(`API_ERROR: ${errorMessage}`);
                }
              }

              return response;
            },
            catch: (error) => {
              const errorMessage =
                error instanceof Error ? error.message : String(error);

              // Log the raw error for debugging
              console.error("Resend API error caught", {
                errorMessage,
                errorType:
                  error instanceof Error
                    ? error.constructor.name
                    : typeof error,
              });

              // Check if it's a client error that shouldn't be retried
              if (errorMessage.includes("CLIENT_ERROR:")) {
                return new EmailServiceError(
                  errorMessage.replace("CLIENT_ERROR: ", ""),
                  undefined,
                  "resend"
                );
              }

              // Only treat actual network/connection errors as NetworkError
              if (
                errorMessage.includes("ECONNREFUSED") ||
                errorMessage.includes("ETIMEDOUT") ||
                errorMessage.includes("ENOTFOUND") ||
                errorMessage.includes("network") ||
                errorMessage.includes("API_ERROR:")
              ) {
                return new NetworkError({
                  message: 'Resend network error',
                  cause: error,
                });
              }

              // Default to EmailServiceError for unknown errors (won't retry)
              return new EmailServiceError(
                `Resend error: ${errorMessage}`,
                undefined,
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
        } catch (error) {
          yield* Effect.logError("Resend send error", { error });
          return yield* Effect.fail(
            new NetworkError({
              message: 'Resend API error',
              cause: error,
            })
          );
        }
      }),

    verify: () =>
      Effect.gen(function* () {
        return yield* Effect.tryPromise({
          try: async () => {
            // Resend doesn't have a specific verify endpoint,
            // but we can try to fetch domains to verify the API key works
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
