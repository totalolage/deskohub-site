import { Effect } from "effect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { refreshCheckoutStatus } from "@/features/checkout/backend/checkout-status.server";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import { CheckoutOrderPage } from "@/features/checkout/components/checkout-order-page";
import {
  appendExistingCheckoutReturnStateToken,
  getCheckoutReturnStateTokenFromSearchParams,
} from "@/features/checkout/schemas/checkout-return-state-token";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { loadWorkspaceAvailability } from "@/features/reservation/backend/workspace-availability.server";
import { getWorkspaceAvailabilityQueryFromReservationSearchParams } from "@/features/reservation/schemas/reservation-checkout-query";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import {
  getSearchParam,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

export const dynamic = "force-dynamic";

type LocalizedCheckoutOrderPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const loadCheckoutStatus = (orderId: string) =>
  refreshCheckoutStatus({ orderId, returnOutcome: "unknown" });

const getRetryOutcome = (status: CheckoutStatusViewModel["status"]) => {
  if (status === "cancelled") return "cancelled";
  if (status === "payment_failed" || status === "expired") return "failed";
  return undefined;
};

const getCheckoutPaymentRetryRedirectPath = (input: {
  readonly locale: string;
  readonly orderId: string;
  readonly outcome: "cancelled" | "failed";
  readonly searchParams: SearchParamsRecord;
}) => {
  const url = new URL(
    `/${input.locale}/checkout/payment/${input.orderId}`,
    "https://deskohub.local"
  );
  url.searchParams.set("outcome", input.outcome);
  appendExistingCheckoutReturnStateToken(url, input.searchParams);
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  return `${url.pathname}${url.search}`;
};

export async function generateMetadata({
  params,
}: LocalizedCheckoutOrderPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.checkoutOrderMetadataTitle({}, { locale });
    const description = m.checkoutOrderMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(locale, "/checkout/order");

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(itemLocale, "/checkout/order"),
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
    } satisfies Metadata;
  });
}

export default async function LocalizedCheckoutOrderPage({
  params,
  searchParams,
}: LocalizedCheckoutOrderPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const rawSearchParams = await searchParams;
  const paymentOrderId = getSearchParam(rawSearchParams, "paymentOrderId");

  if (
    paymentOrderId &&
    getCheckoutReturnStateTokenFromSearchParams(rawSearchParams)
  ) {
    const status = await loadCheckoutStatus(paymentOrderId).catch(
      async (cause) => {
        await Effect.logError("Checkout status refresh failed", {
          paymentOrderId,
          cause,
        }).pipe(runWorkspaceEffect);
        return undefined;
      }
    );
    const retryOutcome = status ? getRetryOutcome(status.status) : undefined;

    if (retryOutcome) {
      redirect(
        getCheckoutPaymentRetryRedirectPath({
          locale,
          orderId: paymentOrderId,
          outcome: retryOutcome,
          searchParams: rawSearchParams,
        })
      );
    }
  }

  const initialAvailabilityQuery =
    getWorkspaceAvailabilityQueryFromReservationSearchParams(rawSearchParams);
  const initialAvailability = await loadWorkspaceAvailability(
    initialAvailabilityQuery
  );

  return runWithRequestLocale(locale, () => (
    <CheckoutOrderPage
      initialAvailability={initialAvailability}
      locale={locale}
      searchParams={rawSearchParams}
    />
  ));
}
