import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import type { Locale } from "@/features/i18n";
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
  await connection();

  return discoverActivePublicSales(input).pipe(
    Effect.map(({ activeSales }) => activeSales),
    Effect.orElseSucceed(() => []),
    runWorkspaceEffect("discounts.active-public-sales.load")
  );
}

/**
 * The sales the calendar runs now, and whether it answered completely. It
 * reads no request, so it suits a cached render that decided the
 * `calendar_sales` gate beforehand.
 */
export const discoverActivePublicSales = Effect.fn(
  "Discounts.discoverActivePublicSales"
)((input: { readonly locale: Locale }) =>
  CalendarDiscountProvider.pipe(
    Effect.flatMap((provider) => provider.discoverActiveSales(input)),
    Effect.tapError((cause) =>
      logDiscountResolutionFailure({
        cause,
        operation: "discover_active_sales",
        provider: "calendar",
      })
    ),
    Effect.provide(CalendarDiscountProvider.Live)
  )
);
