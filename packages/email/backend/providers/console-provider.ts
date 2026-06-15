import { Effect, Layer } from "effect";
import type { EmailMessage, EmailSendResult } from "../../types/email.types";
import { type EmailProvider, EmailProviderTag } from "../service";

const ConsoleEmailProvider: EmailProvider = {
  name: "console",

  send: (message: EmailMessage) =>
    Effect.gen(function* () {
      const recipients = Array.isArray(message.to)
        ? message.to.map((r) => (typeof r === "string" ? r : r.email))
        : [typeof message.to === "string" ? message.to : message.to.email];

      yield* Effect.logInfo("Console Email Provider - Sending Email", {
        from:
          typeof message.from === "string" ? message.from : message.from.email,
        to: recipients,
        subject: message.subject,
        hasHtml: !!message.html,
        hasText: !!message.text,
        attachments: message.attachments?.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          contentId: attachment.contentId,
        })),
        tags: message.tags,
        metadata: message.metadata,
      });

      if (process.env.NODE_ENV === "development") {
        // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
        console.log(`\n${"=".repeat(60)}`);
        // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
        console.log("EMAIL CONTENT:");
        // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
        console.log("=".repeat(60));
        // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
        console.log("Subject:", message.subject);
        // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
        console.log("To:", recipients.join(", "));
        if (message.text) {
          // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
          console.log("\nText Version:");
          // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
          console.log("-".repeat(40));
          // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
          console.log(message.text);
        }
        if (message.html) {
          // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
          console.log("\nHTML Version (first 500 chars):");
          // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
          console.log("-".repeat(40));
          // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
          console.log(`${message.html.substring(0, 500)}...`);
        }
        // biome-ignore lint/suspicious/noConsole: Console provider intentionally logs to console for development
        console.log(`${"=".repeat(60)}\n`);
      }

      const result: EmailSendResult = {
        id: `console-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        status: "sent",
        provider: "console",
        timestamp: new Date(),
      };

      yield* Effect.logInfo("Console Email Provider - Email sent", {
        id: result.id,
      });

      return result;
    }).pipe(Effect.withSpan("consoleEmailProvider.send")),

  verify: () =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Console Email Provider verification", {
        status: "always valid in development",
      });
      return true;
    }),
};

export const ConsoleEmailProviderLive = Layer.succeed(
  EmailProviderTag,
  ConsoleEmailProvider
);
