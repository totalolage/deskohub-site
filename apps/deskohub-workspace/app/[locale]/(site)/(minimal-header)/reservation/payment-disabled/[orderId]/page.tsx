import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { privateOrderPage } from "@/features/reservation/private-order-page.server";
import { ReviewPaymentDisabledPage } from "@/features/review-accounts/components/review-payment-disabled-page";

// Non-instant like the Pay page it stands in for: the reservation form's
// Server Action redirects here.
export const instant = false;

type LocalizedReviewPaymentDisabledPageProps = {
  params: Promise<{ locale: string; orderId: string }>;
};

const { generateMetadata, readOrderId } = privateOrderPage({
  title: m.reviewPaymentDisabledMetadataTitle,
  description: m.reviewPaymentDisabledMetadataDescription,
});

export { generateMetadata };

export default async function LocalizedReviewPaymentDisabledPage({
  params,
}: LocalizedReviewPaymentDisabledPageProps) {
  const orderId = await readOrderId(params);
  return runWithRequestLocale((locale) => (
    <ReviewPaymentDisabledPage locale={locale} orderId={orderId} />
  ));
}
