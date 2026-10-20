/**
 * The form two customer emails are compared in: whole addresses, ignoring
 * case and surrounding whitespace.
 */
export const toCustomerEmailIdentity = (email: string) =>
  email.trim().toLowerCase();
