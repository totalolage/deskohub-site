import { Effect, Layer } from "effect";
import type { EmailMessage, EmailSendResult } from "../../types/email.types";
import { type EmailProvider, EmailProviderTag } from "../service";

const ConsoleEmailProvider: EmailProvider = {
  name: "console",

  send: Effect.fn("consoleEmailProvider.send")(function* (
    message: EmailMessage
  ) {
    const recipientCount = Array.isArray(message.to) ? message.to.length : 1;

    yield* Effect.logInfo("Console Email Provider - Sending Email", {
      attachmentCount: message.attachments?.length ?? 0,
      hasMetadata: message.metadata !== undefined,
      hasHtml: !!message.html,
      hasTags: message.tags !== undefined,
      hasText: !!message.text,
      recipientCount,
    });

    const result: EmailSendResult = {
      id: `console-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      status: "sent",
      provider: "console",
      timestamp: new Date(),
    };

    yield* Effect.logInfo("Console Email Provider - Email sent");

    return result;
  }),

  verify: Effect.gen(function* () {
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
