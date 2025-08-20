import { Config, Effect, Layer } from "effect";
import { Resend } from "resend";
import type {
  EmailMessage,
  EmailProvider,
  EmailSendResult,
} from "@/features/email/types/email.types";
import { NetworkError } from "@/shared/backend/errors";

interface ResendConfig {
  apiKey: string;
}

const ResendConfigLayer = Layer.effect(
  "ResendConfig",
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
            `To: ${typeof message.to === "string" ? message.to : message.to.email}`
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
            try: () =>
              resend.emails.send({
                from:
                  typeof message.from === "string"
                    ? message.from
                    : `${message.from.name || ""} <${message.from.email}>`.trim(),
                to:
                  typeof message.to === "string"
                    ? [message.to]
                    : [message.to.email],
                subject: message.subject,
                html: message.html,
                text: message.text,
                reply_to: message.replyTo,
              }),
            catch: (error) =>
              new NetworkError({
                message: `Failed to send email via Resend: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          yield* Effect.logInfo("Email sent successfully via Resend", {
            id: result.data?.id,
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
              cause: error,
            })
          );
        }
      }),

    sendBatch: (messages: EmailMessage[]) =>
      Effect.gen(function* () {
        if (!resend) {
          // Fallback to sending individually via console
          const results = [];
          for (const message of messages) {
            const result = yield* createResendProvider(config).send(message);
            results.push(result);
          }
          return results;
        }

        try {
          const batchData = messages.map((message) => ({
            from:
              typeof message.from === "string"
                ? message.from
                : `${message.from.name || ""} <${message.from.email}>`.trim(),
            to:
              typeof message.to === "string"
                ? [message.to]
                : [message.to.email],
            subject: message.subject,
            html: message.html,
            text: message.text,
            reply_to: message.replyTo,
          }));

          const result = yield* Effect.tryPromise({
            try: () => resend.batch.send(batchData),
            catch: (error) =>
              new NetworkError({
                message: `Failed to send batch emails via Resend: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                cause: error,
              }),
          });

          return (result.data || []).map((item, index) => ({
            id: "id" in item ? item.id : `resend-batch-${Date.now()}-${index}`,
            provider: "resend",
            timestamp: new Date(),
          })) as EmailSendResult[];
        } catch (error) {
          yield* Effect.logError("Resend batch send error", { error });
          return yield* Effect.fail(
            new NetworkError({
              message: `Resend batch API error: ${
                error instanceof Error ? error.message : String(error)
              }`,
              cause: error,
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

        try {
          // Resend doesn't have a specific verify endpoint,
          // but we can try to fetch domains to verify the API key works
          yield* Effect.tryPromise({
            try: () => resend.domains.list(),
            catch: () => false,
          });

          yield* Effect.logInfo("Resend API key verified successfully");
          return true;
        } catch {
          yield* Effect.logWarning("Resend API key verification failed");
          return false;
        }
      }),
  };
};

export const ResendEmailProviderLive = Layer.effect(
  "EmailProvider",
  Effect.gen(function* () {
    const config = yield* Effect.service("ResendConfig" as any);
    return createResendProvider(config);
  })
).pipe(Layer.provide(ResendConfigLayer));
