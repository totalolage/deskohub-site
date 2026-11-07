import type { SentSignInEmail } from "./web-sign-in";

/**
 * The web sign-in page's step: continue a fresh session, enter the email,
 * then either enter the email's sign-in code or, when the email carries no
 * code, open its link.
 */
export type SignInStep = "continue" | "email" | "code" | "link";

export const signInStep = (
  continueAs: string | undefined,
  sent: SentSignInEmail | undefined
): SignInStep => {
  if (continueAs !== undefined) return "continue";
  if (sent === undefined) return "email";
  return sent.signInCode ? "code" : "link";
};
