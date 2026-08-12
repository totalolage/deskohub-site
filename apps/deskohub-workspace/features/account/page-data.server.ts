import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CustomerAccountService } from "./backend/customer-account.service";
import type { CustomerReservationHistory } from "./contracts";
import { requireCustomerSession } from "./session.server";

const unavailableHistory: CustomerReservationHistory = {
  kind: "unavailable",
  reason: "provider-unavailable",
};

export const loadCustomerAccountPage = cache(async (locale: Locale) => {
  const { accountId, session } = await requireCustomerSession(locale);
  const history = session.user.emailVerified
    ? await Effect.gen(function* () {
        const accounts = yield* CustomerAccountService;
        return yield* accounts.loadReservationHistory({
          accountId,
          email: session.user.email,
          name: session.user.name,
        });
      }).pipe(
        Effect.catch(() =>
          Effect.logError("Customer reservation history load failed").pipe(
            Effect.annotateLogs({
              accountBoundary: "reservation-history",
              accountFailure: "temporarily-unavailable",
            }),
            Effect.as(unavailableHistory)
          )
        ),
        Effect.provide(CustomerAccountService.LiveWithDependencies),
        runWorkspaceEffect("account.reservation-history", { boundary: "route" })
      )
    : ({
        kind: "unavailable",
        reason: "email-unverified",
      } satisfies CustomerReservationHistory);

  return {
    profile: {
      email: session.user.email,
      name: session.user.name,
    },
    history,
  };
});
