import "server-only";

import { Effect, Layer } from "effect";
import { cacheLife } from "next/cache";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { loadPublicOfferings } from "@/features/checkout/backend/checkout/public-offerings";
import {
  getPublicCatalogOfferings,
  type PublicOffering,
} from "@/features/checkout/public-offerings";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  type PublicPageMarkdownSources,
  publicPageMarkdown,
} from "../public-page-markdown";
import type { PublicPagePathname } from "../public-pages";

/**
 * The offerings at their advertised prices, as the reservation pages show
 * them. When pricing fails, the regular catalog prices stand in, as they do
 * on the HTML page until its prices load, and `onIncomplete` runs so the
 * caller doesn't share that answer.
 */
const loadMarkdownOfferings = (
  locale: Locale,
  officeOpen: boolean,
  onIncomplete: () => void
): Effect.Effect<ReadonlyArray<PublicOffering>> =>
  loadPublicOfferings(locale).pipe(
    Effect.map(({ offerings }) => offerings),
    Effect.provide(
      Layer.mergeAll(
        // Referral discounts belong to a signed-in customer, never to an
        // anonymous advertised price, and the cached render has no request
        // to evaluate the referral flag for.
        CheckoutPricingService.Live.pipe(
          Layer.provideMerge(ReferralFeatureFlagService.fromDecision(false))
        ),
        SharedAvailabilityInventoryLive,
        Layer.succeed(OfficeReservationFeatureFlagService, {
          isEnabled: Effect.succeed(officeOpen),
        })
      )
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning(
        "Advertised prices are unavailable; Markdown shows catalog prices",
        { cause }
      ).pipe(
        Effect.andThen(Effect.sync(onIncomplete)),
        Effect.as(
          getPublicCatalogOfferings({
            locale,
            ...(officeOpen && { office: {} }),
          }).map((offering): PublicOffering => {
            // The office advertises one day with one seat.
            const price =
              offering.kind === "office"
                ? workspaceMoneyWithValue(
                    offering.price.value + offering.seatPrice.value,
                    offering.price
                  )
                : offering.price;
            return {
              ...offering,
              advertisedPrice: {
                price,
                discount: workspaceMoneyWithValue(0, price),
              },
            };
          })
        )
      )
    )
  );

/**
 * The sources a cached Markdown render reads, given the pages the request
 * found published; release gates are decided there, never in the cached
 * render. `isComplete` turns false when a source had to fall back, so the
 * render that used it isn't shared.
 */
export const createMarkdownSources = (
  locale: Locale,
  publishedPathnames: ReadonlyArray<PublicPagePathname>
) => {
  const published = new Set(publishedPathnames);
  let complete = true;
  const sources: PublicPageMarkdownSources = {
    isPublished: (pathname) => published.has(pathname),
    // The office page is published exactly while office reservations are open.
    offerings: Effect.suspend(() =>
      loadMarkdownOfferings(
        locale,
        published.has("/reservation/office"),
        () => {
          complete = false;
        }
      )
    ),
  };
  return { sources, isComplete: () => complete };
};

/**
 * A public page's Markdown in `locale`. It reads no per-request data, so it
 * is shared like other public content; a render that had to fall back to
 * catalog prices is not shared.
 */
export async function renderPublicPageMarkdown(
  locale: Locale,
  pathname: PublicPagePathname,
  publishedPathnames: ReadonlyArray<PublicPagePathname>
): Promise<string> {
  "use cache";
  cacheLife("publicContent");

  const { sources, isComplete } = createMarkdownSources(
    locale,
    publishedPathnames
  );
  const blocks = await publicPageMarkdown[pathname]
    .render(locale, sources)
    .pipe(
      runWorkspaceEffect("publicPageMarkdown.render", { boundary: "route" })
    );

  if (!isComplete()) cacheLife({ expire: 0 });
  return serializeMarkdown(blocks);
}
