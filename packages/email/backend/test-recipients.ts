import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";

/** Whether mail to this address goes to Console instead of being sent. */
export const isTestEmailRecipient = (email: string): boolean =>
  email.trim().toLowerCase().endsWith(`@${EMAIL_TEST_DOMAIN}`);
