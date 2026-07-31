import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DiscountServiceLiveWithDependencies } from "@/features/discounts/discount.runtime";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { LandingPage } from "@/features/landing-page/components/landing-page";
import { getActiveLandingPageSaleBanner } from "@/features/landing-page/landing-page-sale-banner.server";
import { defineWorkspacePage } from "@/shared/backend/workspace-effect";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

type LocalizedWorkspaceHomePageProps = {
  readonly params: Promise<{ readonly locale: string }>;
};

const decodeWorkspaceHomeParams = getParamsDecoder({});

export async function generateMetadata({
  params,
}: LocalizedWorkspaceHomePageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
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

export default defineWorkspacePage(
  "landing-page.load",
  Effect.fn("LocalizedWorkspaceHomePage")(function* ({
    params,
  }: LocalizedWorkspaceHomePageProps) {
    const decodedParams = decodeWorkspaceHomeParams(
      yield* Effect.promise(() => params)
    );
    const { locale } = Option.getOrElse(decodedParams, () => notFound());

    yield* Effect.promise(() => connection());
    const saleBanner = yield* getActiveLandingPageSaleBanner({ locale }).pipe(
      Effect.provide(DiscountServiceLiveWithDependencies)
    );

    return yield* Effect.promise(() =>
      runWithRequestLocale(locale, () => (
        <LandingPage locale={locale} saleBanner={saleBanner} />
      ))
    );
  })
);
