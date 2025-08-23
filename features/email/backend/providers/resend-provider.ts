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

          // Fallback to console output in development
          console.log("=".repeat(80));
          console.log("📧 EMAIL (Resend not configured - console fallback)");
          console.log("=".repeat(80));
          console.log(
            `To: ${typeof message.to === "string" ? message.to : Array.isArray(message.to) ? message.to.map((r) => r.email).join(", ") : message.to.email}`
          );
          console.log(
            `From: ${typeof message.from === "string" ? message.from : message.from.email}`
          );
          console.log(`Subject: ${message.subject}`);
          console.log("-".repeat(80));

          if (message.html) {
            console.log("HTML Content (preview):");
            const textPreview = message.html
              .replace(/<[^>]*>/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .substring(0, 500);
            console.log(textPreview);
          } else if (message.text) {
            console.log("Text Content:");
            console.log(message.text);
          }

          console.log("=".repeat(80));

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
          });

          const result = yield* Effect.tryPromise({
            try: async () => {
              console.log("📧 Attempting to send via Resend API...");
              const fromAddress =
                typeof message.from === "string"
                  ? message.from
                  : `${message.from.name || ""} <${message.from.email}>`.trim();

              console.log(`Sending from: ${fromAddress}`);

              const response = await resend.emails.send({
                from: fromAddress,
                to:
                  typeof message.to === "string"
                    ? [message.to]
                    : Array.isArray(message.to)
                      ? message.to.map((r) => r.email)
                      : [message.to.email],
                subject: message.subject,
                html: message.html,
                text: message.text || "",
                replyTo: message.replyTo
                  ? typeof message.replyTo === "string"
                    ? message.replyTo
                    : message.replyTo.email
                  : undefined,
              });

              console.log(
                "Resend API response:",
                JSON.stringify(response, null, 2)
              );

              if (response.error) {
                throw new Error(`Resend API error: ${response.error.message}`);
              }

              return response;
            },
            catch: (error) => {
              console.error("❌ Resend API call failed:", error);
              return new NetworkError({
                message: `Failed to send email via Resend: ${error instanceof Error ? error.message : String(error)}`,
              });
            },
          });

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
