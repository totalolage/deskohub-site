import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { DiscountService } from "@/features/discounts/discount.service";
import { areWorkspaceFeatureFlagsGlobal } from "@/features/feature-flags/backend/feature-flag-evaluation-mode.server";
import type { Locale } from "@/features/i18n";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { getActiveLandingPageSaleBanner } from "../landing-page-sale-banner.server";
import { LandingPageHeroSection } from "./landing-page-hero-section";

type LandingPageHeroProps = {
  locale: Locale;
  overviewSectionId: string;
};

export async function LandingPageHero({
  locale,
  overviewSectionId,
}: LandingPageHeroProps) {
  const props = { locale, overviewSectionId };
  const global = await areWorkspaceFeatureFlagsGlobal([
    "calendar_sales",
    "customer_discounts",
    "discount_codes",
    "meeting_room_page",
    "office_page",
  ]);
  if (global) return GlobalLandingPageHero(props);

  await connection();
  return loadLandingPageHero(props, false);
}

async function GlobalLandingPageHero(props: LandingPageHeroProps) {
  "use cache";
  cacheLife({ stale: 30, revalidate: 60, expire: 300 });

  return loadLandingPageHero(props, true);
}

async function loadLandingPageHero(
  { locale, overviewSectionId }: LandingPageHeroProps,
  global: boolean
) {
  const discountLayer = global
    ? DiscountService.GlobalRelease
    : DiscountService.Live;
  const officeLayer = global
    ? OfficeReservationFeatureFlagService.GlobalRelease
    : OfficeReservationFeatureFlagService.Live;

  const [meetingRoomPageEnabled, saleBanner] = await Promise.all([
    isMeetingRoomPageEnabled(),
    getActiveLandingPageSaleBanner({ locale }).pipe(
      Effect.provide(discountLayer),
      Effect.provide(officeLayer),
      runWorkspaceEffect("landing-page.sale-banner.load", {
        boundary: "page",
      })
    ),
  ]);

  return (
    <LandingPageHeroSection
      locale={locale}
      meetingRoomPageEnabled={meetingRoomPageEnabled}
      overviewSectionId={overviewSectionId}
      saleBanner={saleBanner}
    />
  );
}
