import type { Metadata, ResolvingMetadata } from "next";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LandingPage } from "@/features/landing-page/components/landing-page";
import { createPublicPageMetadata } from "@/features/public-pages/page-metadata";
import { StructuredData } from "@/shared/components/structured-data";
import { getWebSiteStructuredData } from "@/shared/utils/structured-data";

export const instant = false;

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createPublicPageMetadata(
      {
        locale,
        pathname: "/",
        title: { absolute: m.landingMetadataTitle({}, { locale }) },
        description: m.landingMetadataDescription({}, { locale }),
      },
      parent
    )
  );
}

export default async function LocalizedWorkspaceHomePage() {
  return runWithRequestLocale((locale) => (
    <>
      <StructuredData data={getWebSiteStructuredData()} />
      <LandingPage locale={locale} />
    </>
  ));
}
