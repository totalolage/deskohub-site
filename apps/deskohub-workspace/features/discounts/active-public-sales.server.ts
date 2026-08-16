import "server-only";

import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import type { Locale } from "@/features/i18n";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import type { ActiveSale } from "./contracts";
import { logDiscountResolutionFailure } from "./resolution-logging";

export const getActivePublicSales = Effect.fn("Discounts.getActivePublicSales")(
  (input: { readonly locale: Locale }) =>
    WorkspaceFeatureFlagService.pipe(
      Effect.flatMap((featureFlags) =>
        featureFlags.isEnabled("calendar_sales")
      ),
      Effect.tapError((error) =>
        Effect.logWarning(error.message, { cause: error.cause })
      ),
      Effect.orElseSucceed(() => false),
      Effect.flatMap((enabled) =>
        enabled
          ? Effect.promise(() => loadActivePublicSales(input))
          : Effect.succeed([])
      ),
      Effect.provide(WorkspaceFeatureFlagService.Default)
    )
);

async function loadActivePublicSales(input: {
  readonly locale: Locale;
}): Promise<readonly ActiveSale[]> {
  return Effect.Do.pipe(
    Effect.bind("atMillis", () =>
      Effect.promise(() => loadActivePublicSalesEvaluationTime())
    ),
    Effect.let("at", ({ atMillis }) =>
      Temporal.Instant.fromEpochMilliseconds(atMillis)
    ),
    Effect.let("currentDate", ({ at }) => getCurrentWorkspaceDate(at)),
    Effect.flatMap(({ at, currentDate }) =>
      CalendarDiscountProvider.pipe(
        Effect.flatMap((provider) =>
          provider.discoverActiveSales({ ...input, at, currentDate })
        )
      )
    ),
    Effect.tapError((cause) =>
      logDiscountResolutionFailure({
        cause,
        operation: "discover_active_sales",
        provider: "calendar",
      })
    ),
    Effect.orElseSucceed(() => []),
    Effect.provide(CalendarDiscountProvider.Live),
    runWorkspaceEffect("discounts.active-public-sales.load")
  );
}

async function loadActivePublicSalesEvaluationTime(): Promise<number> {
  "use cache";
  cacheLife("publicContent");
  return Date.now();
}
