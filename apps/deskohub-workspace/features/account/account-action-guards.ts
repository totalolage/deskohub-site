import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CustomerAuthentication } from "./backend/customer-authentication.service";
import { CustomerAccountAccessError } from "./customer-account";
import {
  areAccountAvatarsEnabled,
  areAccountsEnabled,
} from "./server/account-feature-flag.server";

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

export const accountActionErrorMessage = (
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

export const requireAccountsEnabled = (locale: Locale) =>
  Effect.promise(areAccountsEnabled).pipe(
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
  Effect.tryPromise({
    try: areAccountAvatarsEnabled,
    catch: () => false,
  }).pipe(
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
