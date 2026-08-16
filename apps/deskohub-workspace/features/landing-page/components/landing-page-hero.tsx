import { Effect } from "effect";
import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { getActiveLandingPageSaleBanner } from "../landing-page-sale-banner.server";
import { LandingPageHeroSection } from "./landing-page-hero-section";
import { LandingPageSaleBanner } from "./landing-page-sale-banner";

type LandingPageHeroProps = {
  locale: Locale;
  overviewSectionId: string;
};

export async function LandingPageHero({
  locale,
  overviewSectionId,
}: LandingPageHeroProps) {
  const meetingRoomPageEnabled = await isMeetingRoomPageEnabled();

  return (
    <LandingPageHeroSection
      locale={locale}
      meetingRoomPageEnabled={meetingRoomPageEnabled}
      overviewSectionId={overviewSectionId}
      saleBanner={
        <Suspense fallback={null}>
          <ActiveLandingPageSaleBanner locale={locale} />
        </Suspense>
      }
    />
  );
}

async function ActiveLandingPageSaleBanner({ locale }: { locale: Locale }) {
  const saleBanner = await getActiveLandingPageSaleBanner({ locale }).pipe(
    Effect.provide(OfficeReservationFeatureFlagService.Live),
    runWorkspaceEffect("landing-page.sale-banner.load", {
      boundary: "page",
    })
  );

  return saleBanner ? (
    <div data-landing-page-sale-banner="">
      <LandingPageSaleBanner content={saleBanner} />
    </div>
  ) : null;
}
