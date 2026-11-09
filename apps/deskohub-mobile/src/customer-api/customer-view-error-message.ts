import { Match } from "effect";
import type { AppLocale } from "../i18n/app-locale";
import { m } from "../i18n/messages";
import type { CustomerViewError } from "./customer-view-error";

/**
 * The shared sentence for a failure every screen words the same way, or
 * `undefined` for one only the screen can explain (a missing reservation, a
 * refused avatar, an unreleased feature): the screen passes its own copy.
 */
export const sharedViewErrorMessage = (
  error: CustomerViewError,
  locale: AppLocale
): string | undefined =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      SessionRequired: () => m.account_error_session({}, { locale }),
      RateLimited: () => m.account_error_rate_limited({}, { locale }),
      Unavailable: () => m.account_error_unavailable({}, { locale }),
      TimedOut: () => m.account_error_timeout({}, { locale }),
      Unconfirmed: () => m.account_save_unconfirmed({}, { locale }),
      Unexpected: () => m.account_error_unexpected({}, { locale }),
      LinkRequired: ({ reason }) =>
        ({
          "profile-missing": () =>
            m.account_notice_completion_required({}, { locale }),
          "support-required": () =>
            m.account_notice_support_required({}, { locale }),
          "deletion-pending": () =>
            m.account_notice_deletion_pending({}, { locale }),
        })[reason](),
      FeatureUnavailable: () => undefined,
      NotFound: () => undefined,
      AccessCodeUnavailable: () => undefined,
      InvoiceNotIssued: () => undefined,
      AvatarRejected: () => undefined,
      MarketingPreferencesStale: () => undefined,
      AuthRejected: () => undefined,
    })
  );
