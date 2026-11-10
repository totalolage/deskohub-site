import type { Metadata } from "next";
import { CheckoutStatusRoute } from "@/features/checkout/components/checkout-status-route";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { homeScreenAppMetadata } from "@/features/mobile-distribution/home-screen-app-metadata";
import { InstallLaunchRedirect } from "@/features/mobile-distribution/install-launch-redirect";
import { SignedInInstallBar } from "@/features/mobile-distribution/signed-in-install-bar";
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

const orderPage = privateOrderPage({
  title: m.checkoutStatusMetadataTitle,
  description: m.checkoutStatusMetadataDescription,
});

export const generateMetadata = async (
  props: Parameters<typeof orderPage.generateMetadata>[0]
): Promise<Metadata> => ({
  ...(await orderPage.generateMetadata(props)),
  ...homeScreenAppMetadata,
});

export default function LocalizedCheckoutStatusPage({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  return runWithRequestLocale((locale) => (
    <>
      <CheckoutStatusRoute params={params} searchParams={searchParams} />
      <InstallLaunchRedirect />
      <SignedInInstallBar locale={locale} placement="page" />
    </>
  ));
}
