import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workspaceCoworkProductTiers } from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { LandingPage } from "@/features/landing-page/components/landing-page";
import { getLandingPageSaleBannerContent } from "@/features/landing-page/landing-page-sale-banner-content";
import { defineWorkspacePage } from "@/shared/backend/workspace-effect";

type SaleBannerThreePreviewPageProps = {
  readonly params: Promise<{ readonly locale: string }>;
};

const decodeSaleBannerPreviewParams = getParamsDecoder({});

export const metadata: Metadata = {
  title: "Sale banner preview",
  robots: {
    follow: false,
    index: false,
  },
};

export default defineWorkspacePage(
  "sale-banner.preview",
  Effect.fn("SaleBannerThreePreviewPage")(function* ({
    params,
  }: SaleBannerThreePreviewPageProps) {
    const decodedParams = decodeSaleBannerPreviewParams(
      yield* Effect.promise(() => params)
    );
    const { locale } = Option.getOrElse(decodedParams, () => notFound());

    return yield* Effect.promise(() =>
      runWithRequestLocale(locale, () => (
        <LandingPage
          locale={locale}
          saleBanner={getLandingPageSaleBannerContent({
            locale,
            reservationKind: "cowork",
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
          })}
        />
      ))
    );
  })
);
