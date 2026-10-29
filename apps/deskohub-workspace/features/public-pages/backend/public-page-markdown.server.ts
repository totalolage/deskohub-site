import "server-only";

import { Effect, Layer, Ref } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { loadPublicPriceList } from "@/features/checkout/backend/checkout/public-offerings";
import {
  getPublicCatalogOfferings,
  type PublicOffering,
  type PublicPriceListOffering,
} from "@/features/checkout/public-offerings";
import { discoverActivePublicSales } from "@/features/discounts/active-public-sales.server";
import {
  DiscountReleaseGateService,
  type DiscountReleaseGates,
} from "@/features/discounts/discount-release-gate.service";
import type { Locale } from "@/features/i18n";
import type { LandingPageSaleBannerContent } from "@/features/landing-page/components/landing-page-sale-banner";
import { getLandingPageSaleBanner } from "@/features/landing-page/landing-page-sale-banner.server";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { readSharedSnapshot } from "@/shared/backend/shared-snapshot";
import {
  type MarkdownBlocks,
  serializeMarkdown,
} from "@/shared/markdown/markdown";
import { moneyWithValue } from "@/shared/money/money";
import {
  type PublicPageMarkdownSources,
  publicPageMarkdown,
} from "../public-page-markdown";
import type { PublicPagePathname } from "../public-pages";
import { PublishedPublicPagesService } from "./published-public-pages.service";

/**
 * The release decisions Markdown depends on. The request decides them, as
 * it decides them for the HTML pages, so a render reads no request and can
 * be shared.
 */
export interface PublicPageMarkdownReleases {
  /** The public pages production serves now. */
  readonly publishedPathnames: ReadonlyArray<PublicPagePathname>;
  readonly discountReleaseGates: DiscountReleaseGates;
}

export const decidePublicPageMarkdownReleases = Effect.all({
  publishedPathnames: PublishedPublicPagesService.pipe(
    Effect.flatMap((published) => published.list),
    Effect.map((pages) => pages.map(({ pathname }) => pathname))
  ),
  discountReleaseGates: DiscountReleaseGateService.pipe(
    Effect.flatMap((gates) =>
      gates.evaluate({ operation: "discover_advertised_discounts" })
    ),
    Effect.provide(DiscountReleaseGateService.Live)
  ),
});

/** A source's answer, and whether the source answered completely. */
type Sourced<A> = {
  readonly value: A;
  readonly complete: boolean;
};

// The office page is published exactly while office reservations are open.
const officeDecision = (releases: PublicPageMarkdownReleases) =>
  Layer.succeed(OfficeReservationFeatureFlagService, {
    isEnabled: Effect.succeed(
      releases.publishedPathnames.includes("/reservation/office")
    ),
  });

/** An offering without a quote advertises its catalog price. */
const withCatalogAdvertisedPrice = (
  offering: PublicPriceListOffering
): PublicOffering => {
  if (offering.advertisedPrice) {
    return { ...offering, advertisedPrice: offering.advertisedPrice };
  }
  // The office advertises one day with one seat.
  const price =
    offering.kind === "office"
      ? moneyWithValue(
          offering.price.value + offering.seatPrice.value,
          offering.price
        )
      : offering.price;
  return {
    ...offering,
    advertisedPrice: { price, discount: moneyWithValue(0, price) },
  };
};

/**
 * The offerings at their advertised prices, as the reservation pages show
 * them. An offering whose quote fails keeps its catalog price, and the
 * catalog stands in when pricing cannot run. Markdown shows no seat
 * maximum, so it never reads the availability inventory.
 */
const loadMarkdownOfferings = (
  locale: Locale,
  releases: PublicPageMarkdownReleases
): Effect.Effect<Sourced<ReadonlyArray<PublicOffering>>> =>
  loadPublicPriceList(locale).pipe(
    Effect.map(({ offerings, complete }) => ({
      value: offerings.map(withCatalogAdvertisedPrice),
      complete,
    })),
    Effect.provide(
      Layer.mergeAll(
        // Referral discounts belong to a signed-in customer, never to an
        // anonymous advertised price.
        CheckoutPricingService.withDiscountReleaseGates(
          releases.discountReleaseGates
        ).pipe(
          Layer.provideMerge(ReferralFeatureFlagService.fromDecision(false))
        ),
        officeDecision(releases)
      )
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning(
        "Advertised prices are unavailable; Markdown shows catalog prices",
        { cause }
      ).pipe(
        Effect.as({
          value: getPublicCatalogOfferings({
            locale,
            ...(releases.publishedPathnames.includes("/reservation/office") && {
              office: {},
            }),
          }).map(withCatalogAdvertisedPrice),
          complete: false,
        })
      )
    )
  );

/**
 * The home page's sale banner, as the HTML page shows it. A failed sale
 * lookup leaves the banner out, as it does on the HTML page.
 */
const loadMarkdownSaleBanner = (
  locale: Locale,
  releases: PublicPageMarkdownReleases
): Effect.Effect<Sourced<LandingPageSaleBannerContent | undefined>> =>
  releases.discountReleaseGates.calendarSales
    ? discoverActivePublicSales({ locale }).pipe(
        Effect.flatMap(({ activeSales, complete }) =>
          getLandingPageSaleBanner({ activeSales, locale }).pipe(
            Effect.map((value) => ({ value, complete }))
          )
        ),
        Effect.provide(officeDecision(releases)),
        Effect.orElseSucceed(() => ({ value: undefined, complete: false }))
      )
    : Effect.succeed({ value: undefined, complete: true });

/**
 * Runs `render` over the Markdown sources, each loaded once and only when
 * read. `complete` turns false when a source it read had to fall back, so the
 * result is not shared.
 */
export const renderFromMarkdownSources = <A>(
  locale: Locale,
  releases: PublicPageMarkdownReleases,
  render: (sources: PublicPageMarkdownSources) => Effect.Effect<A>
): Effect.Effect<Sourced<A>> =>
  Effect.gen(function* () {
    const complete = yield* Ref.make(true);
    const read = <B>(load: Effect.Effect<Sourced<B>>) =>
      Effect.cached(
        load.pipe(
          Effect.tap((sourced) =>
            sourced.complete ? Effect.void : Ref.set(complete, false)
          ),
          Effect.map(({ value }) => value)
        )
      );

    const value = yield* render({
      isPublished: (pathname) => releases.publishedPathnames.includes(pathname),
      offerings: yield* read(loadMarkdownOfferings(locale, releases)),
      saleBanner: yield* read(loadMarkdownSaleBanner(locale, releases)),
    });
    return { value, complete: yield* Ref.get(complete) };
  });

/**
 * Serializes a `"use cache"` Markdown render and shares it like other public
 * content; a render whose sources had to fall back is not shared.
 */
export const readSharedMarkdown = async (
  operation: string,
  render: Effect.Effect<Sourced<MarkdownBlocks>>
): Promise<string> => {
  const { value } = await readSharedSnapshot(
    operation,
    render.pipe(
      Effect.map(({ value: blocks, complete }) => ({
        value: serializeMarkdown(blocks),
        complete,
      }))
    ),
    {
      boundary: "route",
      complete: { lifetime: "publicContent" },
      incomplete: {
        when: ({ complete }) => !complete,
        lifetime: { expire: 0 },
      },
    }
  );
  return value;
};

/**
 * A public page's Markdown in `locale`. It reads no per-request data, so it
 * is shared like other public content; a render whose sources had to fall
 * back is not shared.
 */
export async function renderPublicPageMarkdown(
  locale: Locale,
  pathname: PublicPagePathname,
  releases: PublicPageMarkdownReleases
): Promise<string> {
  "use cache";

  return await readSharedMarkdown(
    "publicPageMarkdown.render",
    renderFromMarkdownSources(locale, releases, (sources) =>
      publicPageMarkdown[pathname].render(locale, sources)
    )
  );
}
