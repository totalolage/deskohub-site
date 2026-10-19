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
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  type PublicPageMarkdownSources,
  publicPageMarkdown,
} from "../public-page-markdown";
import type { PublicPagePathname } from "../public-pages";

/** Release decisions the request already made, which a cached render reuses. */
export interface PublicPageMarkdownReleases {
  /** Whether office reservations are open, so the office offer is listed. */
  readonly officeOpen: boolean;
}

/**
 * The offerings at their advertised prices, as the reservation pages show
 * them. When pricing fails, the regular catalog prices stand in, as they do
 * on the HTML page until its prices load, and `onIncomplete` runs so the
 * caller doesn't share that answer.
 */
const loadMarkdownOfferings = (
  locale: Locale,
  { officeOpen }: PublicPageMarkdownReleases,
  onIncomplete: () => void
): Effect.Effect<ReadonlyArray<PublicOffering>> =>
  loadPublicOfferings(locale).pipe(
    Effect.map(({ offerings }) => offerings),
    Effect.provide(
      Layer.mergeAll(
        CheckoutPricingService.Live.pipe(
          Layer.provideMerge(ReferralFeatureFlagRequest)
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
          }).map(
            (offering): PublicOffering => ({
              ...offering,
              advertisedPrice: {
                price: offering.price,
                discount: workspaceMoneyWithValue(0, offering.price),
              },
            })
          )
        )
      )
    )
  );

/**
 * A public page's Markdown in `locale`. It reads no per-request data, so it
 * is shared like other public content; a render that had to fall back to
 * catalog prices is not shared.
 */
export async function renderPublicPageMarkdown(
  locale: Locale,
  pathname: PublicPagePathname,
  releases: PublicPageMarkdownReleases
): Promise<string> {
  "use cache";
  cacheLife("publicContent");

  let complete = true;
  const sources: PublicPageMarkdownSources = {
    offerings: Effect.suspend(() =>
      loadMarkdownOfferings(locale, releases, () => {
        complete = false;
      })
    ),
  };
  const blocks = await publicPageMarkdown[pathname]
    .render(locale, sources)
    .pipe(runWorkspaceEffect("publicPageMarkdown.render", { boundary: "route" }));

  if (!complete) cacheLife({ expire: 0 });
  return serializeMarkdown(blocks);
}
