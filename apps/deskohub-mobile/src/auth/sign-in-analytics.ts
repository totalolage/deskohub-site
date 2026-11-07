/**
 * Sign-in analytics hooks. Issue #993 adds the `sign_in_started` and
 * `sign_in_completed` events and fills these in; until then they record
 * nothing. Never pass tokens, codes, states or email addresses here.
 */
export type SignInMethod = "email" | "passkey";

export const signInStarted = (_method: SignInMethod): void => undefined;

export const signInCompleted = (_method: SignInMethod): void => undefined;
