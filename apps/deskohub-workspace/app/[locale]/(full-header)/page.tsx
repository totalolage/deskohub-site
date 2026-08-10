import { Effect } from "effect";
import type { Metadata } from "next";
import { connection } from "next/server";
import { DiscountServiceLiveWithDependencies } from "@/features/discounts/discount.runtime";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LandingPage } from "@/features/landing-page/components/landing-page";
import { getActiveLandingPageSaleBanner } from "@/features/landing-page/landing-page-sale-banner.server";
import { OfficeReservationFeatureFlagServiceLive } from "@/features/office/backend/office-reservation-feature-flag.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.landingMetadataTitle({}, { locale });
    const description = m.landingMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(locale);

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(itemLocale),
          ])
        ),
      },
      openGraph: {
        title,
        description,
        url,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
    } satisfies Metadata;
  });
}

export default async function LocalizedWorkspaceHomePage() {
  return runWithRequestLocale((locale) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => connection());
      const saleBanner = yield* getActiveLandingPageSaleBanner({ locale }).pipe(
        Effect.provide(DiscountServiceLiveWithDependencies),
        Effect.provide(OfficeReservationFeatureFlagServiceLive)
      );

      return <LandingPage locale={locale} saleBanner={saleBanner} />;
    }).pipe(runWorkspaceEffect("landing-page.load", { boundary: "page" }))
  );
}
