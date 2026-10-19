import "server-only";

import { Effect, Layer } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { loadPublicPriceList } from "@/features/checkout/backend/checkout/public-offerings";
import {
  getPublicCatalogOfferings,
  type PublicPriceListOffering,
} from "@/features/checkout/public-offerings";
import type { Locale } from "@/features/i18n";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";

/**
 * Advertised prices read only the anonymous Calendar sales, cached under the
 * `advertisedPricingSources` profile, and office capacity reads the shared
 * table snapshot. No Dotypos customer is resolved.
 */
const PriceListLive = Layer.mergeAll(
  CheckoutPricingService.Live.pipe(
    Layer.provideMerge(ReferralFeatureFlagRequest)
  ),
  OfficeReservationFeatureFlagService.Live,
  SharedAvailabilityInventoryLive
);

/**
 * Every bookable product for the price page. A runtime that cannot start
 * still renders the catalog prices, without the office, whose release gate
 * is then unknown.
 */
export const loadPriceList = (
  locale: Locale
): Promise<ReadonlyArray<PublicPriceListOffering>> =>
  loadPublicPriceList(locale).pipe(
    Effect.map(({ offerings }) => offerings),
    Effect.provide(PriceListLive),
    runWorkspaceEffectOrElse("pricing.price-list.load", {
      failureCode: "pricing.price_list.load_failed",
      orElse: () => getPublicCatalogOfferings({ locale }),
    })
  );
