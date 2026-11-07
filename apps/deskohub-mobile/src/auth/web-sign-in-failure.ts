import { Data } from "effect";

export type WebSignInOperation =
  | "send-email"
  | "verify-code"
  | "verify-link"
  | "confirm-account"
  | "mint-handoff";

export type WebSignInFailureReason =
  /** BotID judged the request automated. */
  | "automated"
  | "rate-limited"
  /** The per-address cap on sign-in emails is reached. */
  | "address-limit"
  | "wrong-code"
  | "expired-code"
  | "too-many-attempts"
  /** The magic link was used, expired or never valid. */
  | "link-rejected"
  /** The browser session is too old to hand off; sign in again. */
  | "session-not-fresh"
  | "signed-out"
  /**
   * A sign-in came back as another account than the one it had to keep: the
   * server refused the link, or the browser was signed out again.
   */
  | "account-switch"
  /** A reauthentication's account couldn't be confirmed; it was signed out. */
  | "reauthentication-unconfirmed"
  /** This browser can't keep the account a reauthentication must confirm. */
  | "reauthentication-unavailable"
  /** The app's sign-in request expired; start again from the app. */
  | "native-request-expired"
  | "unavailable"
  | "failed";

/** A web sign-in step failed; `reason` decides what the page shows. */
export class WebSignInFailure extends Data.TaggedError("WebSignInFailure")<{
  readonly operation: WebSignInOperation;
  readonly reason: WebSignInFailureReason;
}> {}

const signInCodeRejections: Readonly<Record<string, WebSignInFailureReason>> = {
  INVALID_OTP: "wrong-code",
  OTP_EXPIRED: "expired-code",
  TOO_MANY_ATTEMPTS: "too-many-attempts",
};

/** The reason for a Better Auth error answer, mirroring the site's mapping. */
export const webSignInFailureReason = (
  operation: WebSignInOperation,
  { status, code }: { readonly status?: number; readonly code?: string }
): WebSignInFailureReason => {
  if (code === "BOT_DETECTED") return "automated";
  switch (operation) {
    case "send-email":
      if (status !== 429) return "failed";
      return code === "SIGN_IN_EMAIL_LIMIT_REACHED"
        ? "address-limit"
        : "rate-limited";
    case "verify-code":
      if (code !== undefined && Object.hasOwn(signInCodeRejections, code)) {
        return signInCodeRejections[code] ?? "failed";
      }
      return status === 429 ? "rate-limited" : "failed";
    case "verify-link":
      // The browser's session belongs to another account; the server kept it.
      if (status === 403 && code === "ACCOUNT_SWITCH_REFUSED") {
        return "account-switch";
      }
      return status === 400 ? "link-rejected" : "failed";
    case "confirm-account":
      return "failed";
    case "mint-handoff":
      if (code === "SESSION_NOT_FRESH") return "session-not-fresh";
      if (status === 401) return "signed-out";
      return status === 429 ? "rate-limited" : "failed";
  }
};
