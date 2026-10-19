import type { SignInEmailFailure } from "@/features/account/auth-return";
import { type Locale, m } from "@/features/i18n";

/** The visitor-facing reason a sign-in email was not sent. */
export const signInEmailFailureMessage = (
  reason: SignInEmailFailure,
  locale: Locale
): string =>
  ({
    "address-limit": () => m.accountSignInEmailLimitReached({}, { locale }),
    "rate-limited": () => m.accountSignInRateLimited({}, { locale }),
    automated: () => m.accountSignInAutomatedRequest({}, { locale }),
    // The page asked to continue somewhere it can't; nothing for the visitor
    // to change but trying again.
    "invalid-return-path": () => m.accountSignInRequestFailed({}, { locale }),
    failed: () => m.accountSignInRequestFailed({}, { locale }),
  })[reason]();
