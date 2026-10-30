import "server-only";

import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { MarketingPreferences } from "./backend/marketing-preferences.service";
import type { MarketingPreferencesState } from "./marketing-preferences";

export const getMarketingPreferences = (
  locale: Locale
): Promise<MarketingPreferencesState> =>
  Effect.flatMap(MarketingPreferences, (preferences) => preferences.read).pipe(
    Effect.provide(MarketingPreferences.Live),
    Effect.catch((error) =>
      Effect.logWarning("Marketing preferences are unavailable").pipe(
        Effect.annotateLogs({ failure: error._tag }),
        Effect.as<MarketingPreferencesState>({ status: "unavailable" })
      )
    ),
    Effect.annotateLogs({ locale }),
    runWorkspaceEffect("legal.marketing-preferences.read", { boundary: "page" })
  );
