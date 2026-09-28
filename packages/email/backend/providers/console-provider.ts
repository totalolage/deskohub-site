import { Effect, Layer } from "effect";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendResult,
} from "../../types/email.types";
import { type EmailProvider, EmailProviderTag } from "../capabilities";
import {
  accountMagicLinkEmailCategoryTag,
  isSyntheticE2EEmailRecipient,
  magicLinkPreviewE2ELogCode,
} from "../synthetic-recipient";

const recipientAddresses = (message: EmailMessage): readonly string[] =>
  Array.isArray(message.to)
    ? message.to.map((r) => (typeof r === "string" ? r : r.email))
    : [typeof message.to === "string" ? message.to : message.to.email];

const isAuthMagicLinkMessage = (message: EmailMessage): boolean =>
  (message.tags ?? []).includes(accountMagicLinkEmailCategoryTag);

/**
 * The one explicitly authorized bearer-material log line: a protected Vercel
 * Preview delivering an auth magic link to an exact synthetic E2E recipient
 * prints the rendered TEXT body (which carries the magic link) as a single
 * structured raw-`console.log` line, bypassing Effect/OTel censorship so the
 * E2E runner can read it from Vercel runtime logs. The gate requires the
 * message's ENTIRE recipient set to be exactly one synthetic recipient;
 * anything else takes the silent-suppression path and never discloses body
 * content.
 */
const findPreviewE2ELogRecipient = (
  message: EmailMessage,
  recipients: readonly string[]
): string | undefined => {
  if (process.env.VERCEL_ENV !== "preview") return undefined;
  if (!isAuthMagicLinkMessage(message)) return undefined;
  if (recipients.length !== 1) return undefined;
  const [soleRecipient] = recipients;
  return soleRecipient !== undefined &&
    isSyntheticE2EEmailRecipient(soleRecipient)
    ? soleRecipient
    : undefined;
};

const emitPreviewE2EConsoleDelivery = (recipient: string, text: string) => {
  // Raw console output is the point: the E2E runner reads this line from
  // Vercel runtime logs, outside Effect/OTel logging censorship.
  // biome-ignore lint/suspicious/noConsole: Explicitly authorized preview E2E link delivery channel
  console.log(
    JSON.stringify({
      code: magicLinkPreviewE2ELogCode,
      recipient,
      message: "Synthetic preview magic-link text body for E2E retrieval.",
      text,
    })
  );
};

const ConsoleEmailProvider: EmailProvider = {
  name: "console",

  send: Effect.fn("consoleEmailProvider.send")(function* (
    message: EmailMessage
  ) {
    const recipients = recipientAddresses(message);
    const authMarked = isAuthMagicLinkMessage(message);
    const previewE2ERecipient = findPreviewE2ELogRecipient(message, recipients);

    if (authMarked) {
      if (previewE2ERecipient) {
        // The single authorized bearer-material line for the synthetic
        // Preview E2E gate.
        emitPreviewE2EConsoleDelivery(previewE2ERecipient, message.text ?? "");
      } else {
        // Provider-level guarantee: an auth magic-link message that fails
        // the preview/synthetic gate sends silently with the normal result
        // (keeping the account router's accepted/rejected/failed mapping
        // coherent) and discloses no recipient, subject, or body content —
        // no raw console output and no Effect log beyond non-PII facts.
        // The development banner never prints for auth-marked mail.
        yield* Effect.logInfo("Console Email Provider - Sending Email", {
          category: message.tags?.[0],
          hasHtml: !!message.html,
          hasText: !!message.text,
        });
      }
    } else {
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
    }

    const result: EmailSendResult = {
      id: EmailDeliveryIdSchema.make(
        `console-${Date.now()}-${Math.random().toString(36).substring(7)}`
      ),
      status: "sent",
      provider: "console",
      timestamp: new Date(),
    };

    yield* Effect.logInfo("Console Email Provider - Email sent", {
      id: result.id,
    });

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
