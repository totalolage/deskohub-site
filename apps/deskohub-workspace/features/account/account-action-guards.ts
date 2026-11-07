import { Match } from "effect";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import type { AccountFeatureWithheldError } from "./backend/account-feature-withheld";
import type { CustomerAccountAccessError } from "./customer-account";

/**
 * Words a refused account operation in the action's locale. A withheld
 * feature reads as "unavailable", without naming the feature.
 */
export const accountActionError =
  (locale: Locale) =>
  (
    cause: CustomerAccountAccessError | AccountFeatureWithheldError
  ): PublicSafeActionError =>
    Match.value(cause).pipe(
      Match.tagsExhaustive({
        CustomerAccountAccessError: (access) =>
          new PublicSafeActionError({
            message: accountActionErrorMessage(access, locale),
            cause: access,
          }),
        AccountFeatureWithheldError: () =>
          new PublicSafeActionError({
            message: m.accountUnavailableDescription({}, { locale }),
          }),
      })
    );

const accountActionErrorMessage = (
  cause: CustomerAccountAccessError,
  locale: Locale
) => {
  if (cause.reason === "unauthenticated") {
    return m.accountSessionExpired({}, { locale });
  }
  if (
    cause.reason === "link-required" &&
    cause.linkReason === "deletion-requested"
  ) {
    return m.accountDeletionPendingError({}, { locale });
  }
  return m.accountProfileError({}, { locale });
};
