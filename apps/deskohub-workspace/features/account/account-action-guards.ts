import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { AccountAvatarReleaseGate } from "./backend/account-release-gates";
import { CustomerAuthentication } from "./backend/customer-authentication.service";
import { CustomerAccountAccessError } from "./customer-account";

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
  // The request's one decision, which already fails closed.
  ReferralReleaseGate.isOpen.pipe(
    Effect.filterOrFail(
      (enabled) => enabled,
      () =>
        new PublicSafeActionError({
          message: m.accountUnavailableDescription({}, { locale }),
        })
    ),
    Effect.asVoid
  );

/** Withheld avatars reject the avatar actions. */
export const requireAccountAvatarsEnabled = (locale: Locale) =>
  AccountAvatarReleaseGate.isOpen.pipe(
    Effect.filterOrFail(
      (enabled) => enabled,
      () =>
        new PublicSafeActionError({
          message: m.accountUnavailableDescription({}, { locale }),
        })
    ),
    Effect.asVoid
  );
