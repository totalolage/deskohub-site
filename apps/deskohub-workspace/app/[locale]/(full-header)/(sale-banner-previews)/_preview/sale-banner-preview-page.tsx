import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workspaceCoworkProductTiers } from "@/features/checkout/product-catalog";
import { isLocale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LandingPage } from "@/features/landing-page/components/landing-page";
import type { LandingPageSaleBannerVariant } from "@/features/landing-page/components/landing-page-sale-banner";
import { getLandingPageSaleBannerContent } from "@/features/landing-page/landing-page-sale-banner-content";
import { getCoworkReservationPath } from "@/features/reservation/routes";

type SaleBannerPreviewPageProps = {
  params: Promise<{ locale: string }>;
};

export const saleBannerPreviewMetadata: Metadata = {
  title: "Sale banner preview",
  robots: {
    follow: false,
    index: false,
  },
};

export async function SaleBannerPreviewPage({
  params,
  variant,
}: SaleBannerPreviewPageProps & {
  variant: LandingPageSaleBannerVariant;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => (
    <LandingPage
      locale={locale}
      saleBanner={{
        variant,
        content: getLandingPageSaleBannerContent({
          href: getCoworkReservationPath(locale),
          locale,
          sale: {
            title: m.landingSaleBannerPreviewTitle({}, { locale }),
            adjustment: {
              kind: "percentage",
              basisPoints: 2000,
            },
            products: workspaceCoworkProductTiers.map((tier) => ({
              kind: "cowork",
              tier,
            })),
          },
        }),
      }}
    />
  ));
}
