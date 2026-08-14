import { Effect } from "effect";
import { connection } from "next/server";
import { Suspense } from "react";
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

export function LandingPageHero({
  locale,
  overviewSectionId,
}: LandingPageHeroProps) {
  return (
    <Suspense
      fallback={
        <LandingPageHeroSection
          isPending
          locale={locale}
          meetingRoomPageEnabled={false}
          overviewSectionId={overviewSectionId}
        />
      }
    >
      <LandingPageHeroContent
        locale={locale}
        overviewSectionId={overviewSectionId}
      />
    </Suspense>
  );
}

async function LandingPageHeroContent({
  locale,
  overviewSectionId,
}: LandingPageHeroProps) {
  await connection();
  const [meetingRoomPageEnabled, saleBanner] = await Promise.all([
    isMeetingRoomPageEnabled(),
    getActiveLandingPageSaleBanner({ locale }).pipe(
      Effect.provide(DiscountService.LiveWithDependencies),
      Effect.provide(OfficeReservationFeatureFlagService.LiveWithDependencies),
      runWorkspaceEffect("landing-page.sale-banner.load", {
        boundary: "page",
      })
    ),
  ]);

  return (
    <LandingPageHeroSection
      isPending={false}
      locale={locale}
      meetingRoomPageEnabled={meetingRoomPageEnabled}
      overviewSectionId={overviewSectionId}
      saleBanner={saleBanner}
    />
  );
}
