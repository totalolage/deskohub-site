import { Match } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import type { PasskeyFailure } from "./passkey-failure";

/*
 * The copy a passkey control shows for a failure it doesn't settle quietly.
 * Cancelled and busy ceremonies never reach the screen; they still get the
 * generic sentence so a new failure kind has to choose its own.
 */

export const passkeySignInFailureMessage = (
  failure: PasskeyFailure,
  locale: AppLocale
): string => {
  const failed = () => m.passkey_sign_in_failed({}, { locale });
  return Match.valueTags(failure, {
    PasskeyNotSupported: () => m.passkey_unsupported({}, { locale }),
    PasskeyNoCredential: () => m.passkey_sign_in_no_credential({}, { locale }),
    PasskeyAlreadyRegistered: failed,
    PasskeyCancelled: failed,
    PasskeyCeremonyBusy: failed,
    PasskeyRejected: failed,
    PasskeyCeremonyFailed: failed,
  });
};

export const addPasskeyFailureMessage = (
  failure: PasskeyFailure,
  locale: AppLocale
): string => {
  const failed = () => m.passkey_add_failed({}, { locale });
  return Match.valueTags(failure, {
    PasskeyNotSupported: () => m.passkey_unsupported({}, { locale }),
    PasskeyAlreadyRegistered: () =>
      m.passkey_add_already_registered({}, { locale }),
    PasskeyNoCredential: failed,
    PasskeyCancelled: failed,
    PasskeyCeremonyBusy: failed,
    PasskeyRejected: failed,
    PasskeyCeremonyFailed: failed,
  });
};
