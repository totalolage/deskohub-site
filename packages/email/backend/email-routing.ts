import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import type { EmailMessage, EmailRecipient } from "../types/email.types";
import { isTestEmailRecipient } from "./test-recipients";

const recipientList = (
  recipients: EmailRecipient | EmailRecipient[] | undefined
): EmailRecipient[] => [recipients ?? []].flat();

/**
 * Whether every recipient of the message is a test recipient. Recipient
 * routing logs such mail through Console and never sends it; mail that
 * reaches any other recipient goes through the provider chain.
 */
export const addressesOnlyTestRecipients = (
  message: Pick<EmailMessage, "to" | "cc" | "bcc">
): boolean =>
  [
    ...recipientList(message.to),
    ...recipientList(message.cc),
    ...recipientList(message.bcc),
  ].every((recipient) => isTestEmailRecipient(recipient.email));

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
