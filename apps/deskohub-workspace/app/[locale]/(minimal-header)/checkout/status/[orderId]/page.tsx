import { Effect, Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { refreshCheckoutStatus } from "@/features/checkout/backend/checkout-status.server";
import type {
  CheckoutStatusReturnOutcome,
  CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import { shouldAutoRefreshCheckoutStatus } from "@/features/checkout/checkout-status-refresh-policy";
import { CheckoutStatusAutoRefresh } from "@/features/checkout/components/checkout-status-auto-refresh";
import { CheckoutStatusPage } from "@/features/checkout/components/checkout-status-page";
import {
  appendExistingCheckoutReturnStateToken,
  getCheckoutReturnStateTokenFromSearchParams,
} from "@/features/checkout/schemas/checkout-return-state-token";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import {
  getSearchParamsDecoder,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

export const maxDuration = 15;

type LocalizedCheckoutStatusPageProps = {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const decodeCheckoutStatusParams = getParamsDecoder({
  orderId: Schema.NonEmptyString,
});

const decodeCheckoutStatusSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.Literals(["success", "cancelled"]),
  })
);

const loadCheckoutStatus = (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome
) => refreshCheckoutStatus({ orderId, returnOutcome });

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
}: LocalizedCheckoutStatusPageProps): Promise<Metadata> {
  const decodedParams = decodeCheckoutStatusParams(await params);
  const { locale, orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale(locale, () => {
    const title = m.checkoutStatusMetadataTitle({}, { locale });
    const description = m.checkoutStatusMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(
      locale,
      `/checkout/status/${orderId}`
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
              `/checkout/status/${orderId}`
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
    } satisfies Metadata;
  });
}

export default function LocalizedCheckoutStatusPage({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  return (
    <Suspense fallback={null}>
      <CheckoutStatusContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CheckoutStatusContent({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  const decodedParams = decodeCheckoutStatusParams(await params);
  const { locale, orderId } = Option.getOrElse(decodedParams, () => notFound());

  await connection();
  const rawSearchParams = await searchParams;
  const { outcome: returnOutcome } = Option.getOrElse(
    decodeCheckoutStatusSearchParams(rawSearchParams),
    () => ({ outcome: "unknown" as const })
  );
  const status = await loadCheckoutStatus(orderId, returnOutcome).catch(
    async (cause) => {
      await Effect.logError("Checkout status load failed", {
        orderId,
        returnOutcome,
        cause,
      }).pipe(runWorkspaceEffect);
      throw cause;
    }
  );
  const retryOutcome = getRetryOutcome(status.status);

  if (
    retryOutcome &&
    getCheckoutReturnStateTokenFromSearchParams(rawSearchParams)
  ) {
    redirect(
      getCheckoutPaymentRetryRedirectPath({
        locale,
        orderId,
        outcome: retryOutcome,
        searchParams: rawSearchParams,
      })
    );
  }

  return runWithRequestLocale(locale, () => (
    <>
      <CheckoutStatusAutoRefresh
        enabled={shouldAutoRefreshCheckoutStatus(status.status)}
      />
      <CheckoutStatusPage locale={locale} status={status} />
    </>
  ));
}
