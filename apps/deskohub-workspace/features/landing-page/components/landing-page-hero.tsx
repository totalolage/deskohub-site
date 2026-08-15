import { Effect } from "effect";
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
  const [meetingRoomPageEnabled, saleBanner] = await Promise.all([
    isMeetingRoomPageEnabled(),
    getActiveLandingPageSaleBanner({ locale }).pipe(
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
