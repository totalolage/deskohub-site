import "server-only";

import { Effect, Result } from "effect";
import { redirect } from "next/navigation";
import { cache } from "react";
import { resolveCurrentCustomerAccount } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import type { CustomerProfile } from "@/features/account/backend/customer-dotypos-adapter.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import { CustomerReservationHistoryService } from "@/features/account/backend/customer-reservation-history.service";
import type { CustomerReservationHistory } from "@/features/account/contracts";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * The closed set of account page states. Every state is derived from the
 * authoritative Better Auth session and the Dotypos link, never from the
 * proxy or cookies.
 */
export type CustomerAccountPageState =
  | { readonly kind: "unavailable" }
  | { readonly kind: "completion-required"; readonly email: string }
  | {
      readonly kind: "linked";
      readonly email: string;
      readonly profile: CustomerProfile;
      readonly history: CustomerReservationHistory;
    }
  | { readonly kind: "support-required" }
  | { readonly kind: "deletion-pending"; readonly email: string };

const unavailable = (): CustomerAccountPageState => ({ kind: "unavailable" });

export const loadCustomerAccountPage = cache(
  async (locale: Locale): Promise<CustomerAccountPageState> => {
    const session = await Effect.flatMap(
      CustomerAuthentication,
      (authentication) => authentication.currentUser
    ).pipe(
      Effect.provide(CustomerAuthentication.Default),
      Effect.tapError((error) =>
        Effect.logError("Account authentication failed", { error })
      ),
      Effect.result,
      runWorkspaceEffect("account.profile", { boundary: "page" })
    );
    if (Result.isFailure(session)) return unavailable();

    const user = session.success;
    if (!user) {
      redirect(`/${locale}/auth/sign-in`);
    }
    if (user.deletionRequested) {
      return { kind: "deletion-pending", email: user.email };
    }

    const account = await resolveCurrentCustomerAccount().pipe(
      Effect.tapError((error) =>
        Effect.logError("Account resolution failed", { error })
      ),
      Effect.result,
      runWorkspaceEffect("account.resolve", { boundary: "page" })
    );
    if (Result.isSuccess(account)) {
      const profile = await Effect.flatMap(CustomerProfileService, (service) =>
        service.load(account.success)
      ).pipe(
        Effect.provide(CustomerProfileService.Live),
        Effect.tapError((error) =>
          Effect.logError("Account profile load failed", { error })
        ),
        Effect.result,
        runWorkspaceEffect("account.profile.read", { boundary: "page" })
      );
      if (Result.isFailure(profile)) return unavailable();

      const history = await Effect.flatMap(
        CustomerReservationHistoryService,
        (service) => service.load(account.success)
      ).pipe(
        Effect.provide(CustomerReservationHistoryService.Live),
        Effect.orElseSucceed(
          () =>
            ({ kind: "unavailable", reason: "provider-unavailable" }) as const
        ),
        runWorkspaceEffect("account.reservation-history", {
          boundary: "page",
        })
      );

      return {
        kind: "linked",
        email: user.email,
        profile: profile.success,
        history,
      };
    }

    const failure = account.failure;
    if (failure.reason === "unauthenticated") {
      redirect(`/${locale}/auth/sign-in`);
    }
    if (
      failure.reason === "link-required" &&
      failure.linkReason === "not-found"
    ) {
      return { kind: "completion-required", email: user.email };
    }
    if (
      failure.reason === "link-required" ||
      failure.reason === "unverified-email"
    ) {
      return { kind: "support-required" };
    }
    return unavailable();
  }
);
