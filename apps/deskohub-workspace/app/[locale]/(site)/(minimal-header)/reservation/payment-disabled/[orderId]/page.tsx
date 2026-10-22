import { Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWorkspaceAlternates, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reviewPaymentDisabledPath } from "@/features/review-accounts";
import { ReviewPaymentDisabledPage } from "@/features/review-accounts/components/review-payment-disabled-page";
import { workspaceSiteConstants } from "@/shared/utils";

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
  const orderId = await readOrderId(params);

  return runWithRequestLocale((locale) => {
    const title = m.reviewPaymentDisabledMetadataTitle({}, { locale });
    const description = m.reviewPaymentDisabledMetadataDescription(
      {},
      { locale }
    );
    const alternates = getWorkspaceAlternates(
      locale,
      `${reviewPaymentDisabledPath}/${orderId}`
    );

    return {
      title,
      description,
      alternates,
      openGraph: {
        title,
        description,
        url: alternates.canonical,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    } satisfies Metadata;
  });
}

export default async function LocalizedReviewPaymentDisabledPage({
  params,
}: LocalizedReviewPaymentDisabledPageProps) {
  const orderId = await readOrderId(params);
  return runWithRequestLocale((locale) => (
    <ReviewPaymentDisabledPage locale={locale} orderId={orderId} />
  ));
}
