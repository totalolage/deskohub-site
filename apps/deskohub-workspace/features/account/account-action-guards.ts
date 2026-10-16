import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CustomerAuthentication } from "./backend/customer-authentication.service";
import { CustomerAccountAccessError } from "./customer-account";
import { areAccountAvatarsEnabled } from "./server/account-feature-flag.server";

export const requireVerifiedSession = Effect.flatMap(
  CustomerAuthentication,
  (authentication) => authentication.currentUser
).pipe(
  Effect.flatMap((user) =>
    user
      ? Effect.succeed(user)
      : Effect.fail(
          new CustomerAccountAccessError({ reason: "unauthenticated" })
        )
  )
);

export const accountActionError =
  (locale: Locale) =>
  (cause: CustomerAccountAccessError): PublicSafeActionError =>
    new PublicSafeActionError({
      message: accountActionErrorMessage(cause, locale),
      cause,
    });

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

/** A withheld referral program rejects referral-only account actions. */
export const requireReferralsEnabled = (locale: Locale) =>
  ReferralFeatureFlagService.pipe(
    // The request's one decision, which already fails closed.
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.filterOrFail(
      (enabled) => enabled,
      () =>
        new PublicSafeActionError({
          message: m.accountUnavailableDescription({}, { locale }),
        })
    ),
    Effect.asVoid
  );

export const requireAccountAvatarsEnabled = (locale: Locale) =>
  Effect.tryPromise(areAccountAvatarsEnabled).pipe(
    // An unreadable avatar flag fails closed: avatars stay unavailable.
    Effect.orElseSucceed(() => false),
    Effect.filterOrFail(
      (enabled) => enabled,
      () =>
        new PublicSafeActionError({
          message: m.accountUnavailableDescription({}, { locale }),
        })
    ),
    Effect.asVoid
  );
