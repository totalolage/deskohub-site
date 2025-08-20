/**
 * Console Email Provider
 *
 * A development email provider that logs emails to the console
 * instead of actually sending them.
 */

import { Effect, Layer } from "effect";
import type { EmailMessage, EmailSendResult } from "../../types/email.types";
import { type EmailProvider, EmailProviderTag } from "../service";

/**
 * Console Email Provider Implementation
 * Logs emails to console for development/testing
 */
const ConsoleEmailProvider: EmailProvider = {
  name: "console",

  send: (message: EmailMessage) =>
    Effect.gen(function* () {
      const recipients = Array.isArray(message.to)
        ? message.to.map((r) => (typeof r === "string" ? r : r.email))
        : [typeof message.to === "string" ? message.to : message.to.email];

      yield* Effect.logInfo("📧 Console Email Provider - Sending Email", {
        from:
          typeof message.from === "string" ? message.from : message.from.email,
        to: recipients,
        subject: message.subject,
        hasHtml: !!message.html,
        hasText: !!message.text,
        tags: message.tags,
        metadata: message.metadata,
      });

      // Log the actual content in development
      if (process.env.NODE_ENV === "development") {
        console.log(`\n${"=".repeat(60)}`);
        console.log("EMAIL CONTENT:");
        console.log("=".repeat(60));
        console.log("Subject:", message.subject);
        console.log("To:", recipients.join(", "));
        if (message.text) {
          console.log("\nText Version:");
          console.log("-".repeat(40));
          console.log(message.text);
        }
        if (message.html) {
          console.log("\nHTML Version (first 500 chars):");
          console.log("-".repeat(40));
          console.log(`${message.html.substring(0, 500)}...`);
        }
        console.log(`${"=".repeat(60)}\n`);
      }

      const result: EmailSendResult = {
        id: `console-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        status: "sent",
        provider: "console",
        timestamp: new Date(),
      };

      yield* Effect.logInfo("✅ Console Email Provider - Email 'sent'", {
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

/**
 * Console Email Provider Layer
 */
export const ConsoleEmailProviderLive = Layer.succeed(
  EmailProviderTag,
  ConsoleEmailProvider
);
