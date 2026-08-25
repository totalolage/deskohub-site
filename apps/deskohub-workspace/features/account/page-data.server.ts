import "server-only";

import { Effect, Result } from "effect";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { resolveCurrentCustomerAccount } from "./backend/customer-account-resolver.service";
import { CustomerAuthentication } from "./backend/customer-authentication.service";
import { CustomerReservationHistoryService } from "./backend/customer-reservation-history.service";
import type { CustomerReservationHistory } from "./contracts";
import type { CustomerAccountAccessFailure } from "./customer-account";

export type CustomerAccountPageData =
  | {
      readonly kind: "available";
      readonly history: CustomerReservationHistory;
      readonly profile: { readonly email: string; readonly name: string };
    }
  | { readonly kind: "unavailable" };

const unavailableHistory = (
  reason: Extract<
    CustomerReservationHistory,
    { readonly kind: "unavailable" }
  >["reason"]
): CustomerReservationHistory => ({ kind: "unavailable", reason });

const getUnavailableHistoryReason = (
  reason: CustomerAccountAccessFailure
): Extract<
  CustomerReservationHistory,
  { readonly kind: "unavailable" }
>["reason"] => {
  switch (reason) {
    case "unverified-email":
      return "email-unverified";
    case "link-required":
      return "link-required";
    case "not-configured":
    case "unauthenticated":
    case "unavailable":
      return "provider-unavailable";
  }
};

export const loadCustomerAccountPage = cache(
  async (locale: Locale): Promise<CustomerAccountPageData> => {
    const [currentUser, account] = await Promise.all([
      Effect.flatMap(
        CustomerAuthentication,
        (authentication) => authentication.currentUser
      ).pipe(
        Effect.provide(CustomerAuthentication.Default),
        Effect.tapError((error) =>
          Effect.logError("Account authentication failed", { error })
        ),
        Effect.result,
        runWorkspaceEffect("account.profile", { boundary: "page" })
      ),
      resolveCurrentCustomerAccount().pipe(
        Effect.tapError((error) =>
          Effect.logError("Account resolution failed", { error })
        ),
        Effect.result,
        runWorkspaceEffect("account.resolve", { boundary: "page" })
      ),
    ]);
    if (Result.isFailure(currentUser)) return { kind: "unavailable" };
    if (!currentUser.success) {
      redirect(`/${locale}/auth/sign-in?redirectTo=/${locale}/account`);
    }

    const user = currentUser.success;
    if (
      Result.isFailure(account) &&
      account.failure.reason === "unauthenticated"
    ) {
      redirect(`/${locale}/auth/sign-in?redirectTo=/${locale}/account`);
    }

    const history = Result.isFailure(account)
      ? unavailableHistory(getUnavailableHistoryReason(account.failure.reason))
      : await Effect.flatMap(CustomerReservationHistoryService, (service) =>
          service.load(account.success)
        ).pipe(
          Effect.provide(CustomerReservationHistoryService.Live),
          Effect.orElseSucceed(() =>
            unavailableHistory("provider-unavailable")
          ),
          runWorkspaceEffect("account.reservation-history", {
            boundary: "page",
          })
        );

    return {
      kind: "available",
      history,
      profile: { email: user.email, name: user.name },
    };
  }
);
