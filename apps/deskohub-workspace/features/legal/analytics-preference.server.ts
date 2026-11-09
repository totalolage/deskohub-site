import "server-only";

import { Effect, Layer } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type { AnalyticsPreferenceState } from "./analytics-preference";
import { AnalyticsConsentLedger } from "./backend/analytics-consent-ledger";
import { readAnalyticsPreference } from "./backend/analytics-consent-preference";

/** The signed-in account's analytics preference for account preferences. */
export const getAnalyticsPreference = (
  locale: Locale
): Promise<AnalyticsPreferenceState> =>
  readAnalyticsPreference().pipe(
    Effect.provide(
      Layer.mergeAll(
        AnalyticsConsentLedger.Live,
        CustomerAuthentication.Default
      )
    ),
    Effect.catch((error) =>
      Effect.logWarning("Analytics preference is unavailable").pipe(
        Effect.annotateLogs({ failure: error._tag }),
        Effect.as<AnalyticsPreferenceState>({ status: "unavailable" })
      )
    ),
    Effect.annotateLogs({ locale }),
    runWorkspaceEffect("legal.analytics-consent.read-preference", {
      boundary: "page",
    })
  );
