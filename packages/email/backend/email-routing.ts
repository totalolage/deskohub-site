import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import type { EmailMessage, EmailRecipient } from "../types/email.types";
import {
  EmailConfigTag,
  type EmailProvider,
  EmailProviderTag,
} from "./capabilities";
import { ConsoleEmailProvider } from "./providers/console-provider";
import {
  createResendProvider,
  deploymentResendRequestTimeouts,
} from "./providers/resend-provider";
import { isTestEmailRecipient } from "./test-recipients";

export type EmailRoute = "console" | "resend";

const recipientList = (
  recipients: EmailRecipient | EmailRecipient[] | undefined
): EmailRecipient[] => [recipients ?? []].flat();

/**
 * The recipient-based provider decision for every message: mail addressed
 * only to test recipients is logged by Console and never sent; anything that
 * reaches another recipient goes to Resend when a key is configured.
 */
export const routeEmailMessage = (
  message: Pick<EmailMessage, "to" | "cc" | "bcc">
): EmailRoute =>
  [
    ...recipientList(message.to),
    ...recipientList(message.cc),
    ...recipientList(message.bcc),
  ].every((recipient) => isTestEmailRecipient(recipient.email))
    ? "console"
    : "resend";

/**
 * Staff copies follow the provenance of the request that triggered them: a
 * test-recipient origin addresses the staff mailbox's test twin on the test
 * domain, so automated runs never reach staff, and every other origin reaches
 * the real mailbox in every environment.
 */
export const internalRecipientForOrigin = (
  originEmail: string,
  mailbox: { readonly real: EmailRecipient; readonly testLocalPart: string }
): EmailRecipient =>
  isTestEmailRecipient(originEmail)
    ? {
        email: `${mailbox.testLocalPart}@${EMAIL_TEST_DOMAIN}`,
        name: mailbox.real.name,
      }
    : mailbox.real;

const testEmailSubjectPrefix = "[TESTING]";

/**
 * Staff copies sent outside production carry the test tag, whoever triggered
 * them, so staff can tell Preview and local mail from live requests.
 */
export const staffEmailSubject = (
  subject: string,
  environment: { readonly isProduction: boolean }
): string =>
  environment.isProduction ? subject : `${testEmailSubjectPrefix} ${subject}`;

/**
 * Routes each message by its recipients. Without a Resend key every message
 * goes to Console, so environments without credentials never send real mail.
 */
export const RoutedEmailProviderLive = Layer.effect(
  EmailProviderTag,
  Effect.gen(function* () {
    const config = yield* EmailConfigTag;
    const apiKey = config.apiKey?.trim();
    const resend = apiKey
      ? createResendProvider(apiKey, yield* deploymentResendRequestTimeouts)
      : undefined;

    const provider: EmailProvider = {
      name: "routed",
      send: Effect.fn("routedEmailProvider.send")(function* (
        message: EmailMessage
      ) {
        if (!resend || routeEmailMessage(message) === "console") {
          return yield* ConsoleEmailProvider.send(message);
        }
        return yield* resend.send(message);
      }),
      sendBatch: Effect.fn("routedEmailProvider.sendBatch")(
        function* (messages, options) {
          const routes = messages.map((message) =>
            resend ? routeEmailMessage(message) : "console"
          );
          const routed = (route: EmailRoute) =>
            messages.filter((_, index) => routes[index] === route);
          const consoleResults = yield* ConsoleEmailProvider.sendBatch(
            routed("console"),
            options
          );
          const resendMessages = routed("resend");
          const resendResults =
            resend && resendMessages.length > 0
              ? yield* resend.sendBatch(resendMessages, options)
              : [];
          // Put each result back at its message's position.
          const results = { console: consoleResults, resend: resendResults };
          const taken = { console: 0, resend: 0 };
          return routes.map((route) => results[route][taken[route]++]!);
        }
      ),
    };

    return provider;
  })
);
