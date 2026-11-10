import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import { loadGlobalRelease } from "@/features/feature-flags/backend/global-release.server";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import type { ActiveSale } from "./contracts";
import { DiscountReleaseGateService } from "./discount-release-gate.service";
import { logDiscountResolutionFailure } from "./resolution-logging";

/**
 * The sales the calendar runs now, for the visitor of the request. While
 * calendar sales are off for everyone, it answers none without the request;
 * otherwise it waits for the request, since the discount gates may ask
 * PostHog about the visitor and the calendar answers live.
 */
export const getActivePublicSales = Effect.fn("Discounts.getActivePublicSales")(
  (input: { readonly locale: Locale }) =>
    Effect.promise(() => loadGlobalRelease("calendar_sales")).pipe(
      Effect.flatMap(
        (release): Effect.Effect<readonly ActiveSale[]> =>
          release === "off"
            ? Effect.succeed([])
            : Effect.promise(() => connection()).pipe(
                Effect.andThen(loadVisitorActivePublicSales(input))
              )
      )
    )
);

const loadVisitorActivePublicSales = (input: { readonly locale: Locale }) =>
  DiscountReleaseGateService.pipe(
    Effect.flatMap((releaseGates) =>
      releaseGates.evaluate({ operation: "discover_active_sales" })
    ),
    Effect.flatMap(({ calendarSales }) =>
      calendarSales
        ? Effect.promise(() => loadActivePublicSales(input))
        : Effect.succeed([])
    ),
    Effect.provide(DiscountReleaseGateService.Live)
  );

function loadActivePublicSales(input: {
  readonly locale: Locale;
}): Promise<readonly ActiveSale[]> {
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
