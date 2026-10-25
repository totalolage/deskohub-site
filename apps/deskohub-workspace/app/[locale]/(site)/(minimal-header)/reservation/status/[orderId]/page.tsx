import { Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutStatusRoute } from "@/features/checkout/components/checkout-status-route";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { createNoindexedPageMetadata } from "@/features/public-pages/page-metadata";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { SearchParamsRecord } from "@/shared/utils";

// The status refresh bounds its Nexi verification at 40 seconds (one full
// sandbox-length request; see checkout-status.service.ts) and its Dotypos
// reads at 8 seconds, leaving time to render the stored status.
export const maxDuration = 60;
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
  if (Option.isNone(decodeCheckoutStatusParams(await params))) notFound();

  return runWithRequestLocale((locale) => ({
    ...createNoindexedPageMetadata({
      locale,
      title: { absolute: m.checkoutStatusMetadataTitle({}, { locale }) },
      description: m.checkoutStatusMetadataDescription({}, { locale }),
    }),
    referrer: "no-referrer",
  }));
}

export default function LocalizedCheckoutStatusPage({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  return <CheckoutStatusRoute params={params} searchParams={searchParams} />;
}
