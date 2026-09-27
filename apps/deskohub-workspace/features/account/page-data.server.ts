import "server-only";

import { Effect, Result } from "effect";
import { cache } from "react";
import { resolveCurrentCustomerAccount } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerCommunicationPreferenceRepository } from "@/features/account/backend/customer-communication-preference.repository";
import type { CustomerProfile } from "@/features/account/backend/customer-dotypos-adapter.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import { CustomerReservationHistoryService } from "@/features/account/backend/customer-reservation-history.service";
import type { CustomerReservationHistory } from "@/features/account/contracts";
import {
  type CustomerAccountAccessError,
  type CustomerAccountFailureCode,
  mapCustomerAccountFailure,
} from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * The closed set of account page states. Every state is derived from the
 * authoritative Better Auth session and the Dotypos link, never from the
 * proxy or cookies.
 */
export type CustomerAccountPageState =
  | { readonly kind: "unavailable" }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "authenticated-unavailable"; readonly email: string }
  | { readonly kind: "completion-required"; readonly email: string }
  | {
      readonly kind: "linked";
      readonly email: string;
      readonly preferredLanguage: Locale | "read-failed";
      readonly profile: CustomerProfile;
      readonly history: CustomerReservationHistory;
    }
  | { readonly kind: "support-required"; readonly email: string }
  | { readonly kind: "deletion-pending"; readonly email: string };

const unavailable = (): CustomerAccountPageState => ({ kind: "unavailable" });

/**
 * The log-safe diagnostic for a failed preference read: only the fixed,
 * non-PII failure code of the sanitized access error ever reaches telemetry.
 */
const preferenceReadFailureCode = (
  error: CustomerAccountAccessError
): CustomerAccountFailureCode =>
  error.cause?.code ?? "account-communication-preference.read";

export const loadCustomerAccountPage = cache(
  async (_locale: Locale): Promise<CustomerAccountPageState> => {
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
    if (!user) return { kind: "unauthenticated" };
    if (user.deletionRequested) {
      return { kind: "deletion-pending", email: user.email };
    }

    const account = await resolveCurrentCustomerAccount.pipe(
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
      if (Result.isFailure(profile)) {
        return { kind: "authenticated-unavailable", email: user.email };
      }

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

      /**
       * The durable communication-language preference is required for every
       * active account, so there is no unset success state: a saved locale
       * renders, and a missing row or a failed read becomes the explicit
       * "read-failed" operational failure so it never blocks the rest of the
       * page and never renders a guessed value.
       */
      const preferredLanguage = await Effect.flatMap(
        CustomerCommunicationPreferenceRepository,
        (repository) => repository.load(account.success.accountId)
      ).pipe(
        Effect.provide(CustomerCommunicationPreferenceRepository.Live),
        // The raw repository failure never reaches the log: fold it into the
        // fixed non-PII read-failure cause first, matching the other account
        // page reads.
        Effect.mapError(
          mapCustomerAccountFailure("account-communication-preference.read")
        ),
        Effect.tapError((error) =>
          Effect.logError("Account communication preference read failed", {
            code: preferenceReadFailureCode(error),
          })
        ),
        Effect.orElseSucceed(() => "read-failed" as const),
        runWorkspaceEffect("account.communication-language.read", {
          boundary: "page",
        })
      );

      return {
        kind: "linked",
        email: user.email,
        preferredLanguage,
        profile: profile.success,
        history,
      };
    }

    const failure = account.failure;
    if (failure.reason === "unauthenticated") {
      return { kind: "unauthenticated" };
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
      return { kind: "support-required", email: user.email };
    }
    return { kind: "authenticated-unavailable", email: user.email };
  }
);
