import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { DiscountService } from "@/features/discounts/discount.service";
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
  "use cache";
  cacheLife({ stale: 30, revalidate: 60, expire: 300 });

  const [meetingRoomPageEnabled, saleBanner] = await Promise.all([
    isMeetingRoomPageEnabled(),
    getActiveLandingPageSaleBanner({ locale }).pipe(
      Effect.provide(DiscountService.Live),
      Effect.provide(OfficeReservationFeatureFlagService.Live),
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
