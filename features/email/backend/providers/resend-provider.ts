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

    return { apiKey } as ResendConfig;
  })
);

const createResendProvider = (config: ResendConfig): EmailProvider => {
  const resend = config.apiKey ? new Resend(config.apiKey) : null;

  return {
    name: "resend",

    send: (message: EmailMessage) =>
      Effect.gen(function* () {
        if (!resend) {
          yield* Effect.logWarning(
            "Resend provider not configured, falling back to console output",
            { message }
          );

          // In development, the console provider will handle logging

          return {
            id: `console-${Date.now()}`,
            provider: "resend",
            timestamp: new Date(),
          } as EmailSendResult;
        }

        try {
          yield* Effect.logInfo("Sending email via Resend", {
            to: message.to,
            subject: message.subject,
            from: message.from,
          });

          const result = yield* Effect.tryPromise({
            try: async () => {
              console.log("Resend API call starting");
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

              // Resend API response received
              console.log("Resend API response", {
                success: !response.error,
                id: response.data?.id,
                error: response.error,
              });

              if (response.error) {
                const errorMessage = response.error.message || "Unknown error";
                const errorName = response.error.name || "ResendError";

                // Check if it's a client error (4xx) that shouldn't be retried
                if (
                  errorName === "validation_error" ||
                  errorName === "missing_required_field" ||
                  errorName === "invalid_access" ||
                  errorMessage.toLowerCase().includes("invalid") ||
                  errorMessage.toLowerCase().includes("bad request") ||
                  errorMessage.toLowerCase().includes("unauthorized") ||
                  errorMessage.toLowerCase().includes("forbidden")
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
                  message: `Resend network error: ${errorMessage.replace("API_ERROR: ", "")}`,
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
              message: `Resend API error: ${error instanceof Error ? error.message : String(error)}`,
            })
          );
        }
      }),

    verify: () =>
      Effect.gen(function* () {
        if (!resend) {
          yield* Effect.logWarning("Resend not configured for verification");
          return false;
        }

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
