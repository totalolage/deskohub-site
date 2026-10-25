import { Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { createNoindexedPageMetadata } from "@/features/public-pages/page-metadata";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { ReviewPaymentDisabledPage } from "@/features/review-accounts/components/review-payment-disabled-page";

// Non-instant like the Pay page it stands in for: the reservation form's
// Server Action redirects here.
export const instant = false;

type LocalizedReviewPaymentDisabledPageProps = {
  params: Promise<{ orderId: string }>;
};

const decodeParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);

const readOrderId = async (
  params: LocalizedReviewPaymentDisabledPageProps["params"]
) => Option.getOrElse(decodeParams(await params), () => notFound()).orderId;

export async function generateMetadata({
  params,
}: LocalizedReviewPaymentDisabledPageProps): Promise<Metadata> {
  await readOrderId(params);

  return runWithRequestLocale((locale) => ({
    ...createNoindexedPageMetadata({
      locale,
      title: {
        absolute: m.reviewPaymentDisabledMetadataTitle({}, { locale }),
      },
      description: m.reviewPaymentDisabledMetadataDescription({}, { locale }),
    }),
    referrer: "no-referrer",
  }));
}

export default async function LocalizedReviewPaymentDisabledPage({
  params,
}: LocalizedReviewPaymentDisabledPageProps) {
  const orderId = await readOrderId(params);
  return runWithRequestLocale((locale) => (
    <ReviewPaymentDisabledPage locale={locale} orderId={orderId} />
  ));
}
