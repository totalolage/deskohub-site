import { CheckoutStatusRoute } from "@/features/checkout/components/checkout-status-route";
import { m } from "@/features/i18n";
import { privateOrderPage } from "@/features/reservation/private-order-page.server";
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

const { generateMetadata } = privateOrderPage({
  title: m.checkoutStatusMetadataTitle,
  description: m.checkoutStatusMetadataDescription,
});

export { generateMetadata };

export default function LocalizedCheckoutStatusPage({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  return <CheckoutStatusRoute params={params} searchParams={searchParams} />;
}
