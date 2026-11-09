import "server-only";

import { Effect, Option } from "effect";
import { AnalyticsPersonAnonymisation } from "@/features/account/backend/analytics-person-anonymisation";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import type { Locale } from "@/features/i18n";
import type { AnalyticsPreferenceState } from "@/features/legal/analytics-preference";
import { catchRecoverableCause } from "@/shared/backend/workspace-effect";
import { AnalyticsConsentLedger } from "./analytics-consent-ledger";

/**
 * The signed-in account's analytics preference: granted when its current
 * decision is a grant, under any privacy notice. Signed out for a visitor
 * without a session or an account being deleted.
 */
export const readAnalyticsPreference = Effect.fn(
  "AnalyticsConsent.readPreference"
)(function* () {
  const authentication = yield* CustomerAuthentication;
  const session = yield* authentication.currentUser;
  if (!session || session.deletionRequested) {
    return { status: "signed-out" } satisfies AnalyticsPreferenceState;
  }

  const ledger = yield* AnalyticsConsentLedger;
  const current = yield* ledger.currentDecision(session.accountId);
  return {
    status: "available",
    granted: Option.exists(current, ({ decision }) => decision === "grant"),
  } satisfies AnalyticsPreferenceState;
});

/**
 * Records the signed-in account's analytics preference as its decision now,
 * from account preferences, and returns the account it was recorded for with
 * the instant the ledger stored, which the device's consent cookie takes
 * while that account is still the one signed in on the device. A withdrawal also requests the
 * anonymisation of the account's PostHog person; that request never fails
 * the save. None for a signed-out request or an account being deleted,
 * which records nothing.
 */
export const saveAnalyticsPreference = Effect.fn(
  "AnalyticsConsent.savePreference"
)(function* ({
  granted,
  locale,
}: {
  readonly granted: boolean;
  readonly locale: Locale;
}) {
  const authentication = yield* CustomerAuthentication;
  const session = yield* authentication.currentUser;
  if (!session || session.deletionRequested) return Option.none();

  const ledger = yield* AnalyticsConsentLedger;
  const decidedAt = yield* ledger.record({
    accountId: session.accountId,
    decision: granted ? "grant" : "withdraw",
    locale,
    source: "preference",
  });

  if (!granted) {
    const anonymisation = yield* AnalyticsPersonAnonymisation;
    yield* anonymisation.anonymiseWithdrawnAccount(session.accountId).pipe(
      catchRecoverableCause(() =>
        Effect.logWarning(
          "PostHog person anonymisation could not be requested"
        ).pipe(
          Effect.annotateLogs({
            code: "posthog_person_anonymisation_request_failed",
          })
        )
      )
    );
  }

  return Option.some({ accountId: session.accountId, decidedAt });
});
