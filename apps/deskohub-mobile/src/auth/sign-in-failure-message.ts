import { Match } from "effect";
import type { AppLocale } from "../i18n/app-locale";
import { m } from "../i18n/messages";
import type { NativeSignInFailure } from "./native-sign-in-errors";
import type { WebSignInFailureReason } from "./web-sign-in-failure";

/** What the native sign-in and reauthentication show for a failure. */
export const nativeSignInFailureMessage = (
  failure: NativeSignInFailure,
  locale: AppLocale
): string =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      SignInCancelled: () => m.signin_error_cancelled({}, { locale }),
      SignInLinkRefused: ({ reason }) =>
        reason === "expired"
          ? m.signin_error_expired({}, { locale })
          : m.signin_error_link({}, { locale }),
      SignInRejected: () => m.signin_error_rejected({}, { locale }),
      SignInUnavailable: () => m.signin_error_unavailable({}, { locale }),
      AccountSwitchRefused: () => m.signin_error_account_switch({}, { locale }),
      NotSignedIn: () => m.signin_error_not_signed_in({}, { locale }),
    })
  );

/** What the web sign-in pages show for a failure. */
export const webSignInFailureMessage = (
  reason: WebSignInFailureReason,
  locale: AppLocale
): string =>
  Match.value(reason).pipe(
    Match.when("automated", () => m.signin_error_automated({}, { locale })),
    Match.when("rate-limited", () =>
      m.signin_error_rate_limited({}, { locale })
    ),
    Match.when("address-limit", () =>
      m.signin_error_address_limit({}, { locale })
    ),
    Match.when("wrong-code", () => m.signin_error_wrong_code({}, { locale })),
    Match.when("expired-code", () =>
      m.signin_error_expired_code({}, { locale })
    ),
    Match.when("too-many-attempts", () =>
      m.signin_error_too_many_attempts({}, { locale })
    ),
    Match.when("link-rejected", () => m.signin_error_rejected({}, { locale })),
    Match.when("session-not-fresh", () =>
      m.signin_error_session_not_fresh({}, { locale })
    ),
    Match.when("signed-out", () =>
      m.signin_error_not_signed_in({}, { locale })
    ),
    Match.when("account-switch", () =>
      m.signin_error_account_switch({}, { locale })
    ),
    Match.when("reauthentication-unconfirmed", () =>
      m.signin_error_reauth_unconfirmed({}, { locale })
    ),
    Match.when("reauthentication-unavailable", () =>
      m.signin_error_reauth_storage({}, { locale })
    ),
    Match.when("native-request-expired", () =>
      m.signin_error_expired({}, { locale })
    ),
    Match.when("unavailable", () => m.signin_error_unavailable({}, { locale })),
    Match.when("failed", () => m.signin_error_failed({}, { locale })),
    Match.exhaustive
  );
