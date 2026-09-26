import { Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutStatusRoute } from "@/features/checkout/components/checkout-status-route";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import {
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

export const maxDuration = 30;
export const instant = true;

type LocalizedCheckoutStatusPageProps = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const decodeCheckoutStatusParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);

export async function generateMetadata({
  params,
}: LocalizedCheckoutStatusPageProps): Promise<Metadata> {
  const decodedParams = decodeCheckoutStatusParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale((locale) => {
    const title = m.checkoutStatusMetadataTitle({}, { locale });
    const description = m.checkoutStatusMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(
      locale,
      `${reservationStatusPath}/${orderId}`
    );

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(
              itemLocale,
              `${reservationStatusPath}/${orderId}`
            ),
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
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    } satisfies Metadata;
  });
}

export default function LocalizedCheckoutStatusPage({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  return <CheckoutStatusRoute params={params} searchParams={searchParams} />;
}
