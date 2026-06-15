import { Effect, Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { refreshCheckoutStatus } from "@/features/checkout/backend/checkout-status.server";
import type { CheckoutStatusReturnOutcome } from "@/features/checkout/backend/checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
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

export const dynamic = "force-dynamic";

type LocalizedCheckoutPaymentPageProps = {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const decodeCheckoutPaymentParams = getParamsDecoder({
  orderId: Schema.NonEmptyString,
});

const decodeCheckoutPaymentSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.Literal("success", "cancelled"),
  })
);

const refreshStatus = (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome
) => refreshCheckoutStatus({ orderId, returnOutcome });

const getCheckoutStatusRedirectPath = (input: {
  readonly locale: string;
  readonly orderId: string;
  readonly outcome: CheckoutStatusReturnOutcome;
}) => {
  const url = new URL(
    `/${input.locale}/checkout/status/${input.orderId}`,
    "https://deskohub.local"
  );
  url.searchParams.set("outcome", input.outcome);
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  return `${url.pathname}${url.search}`;
};

export async function generateMetadata({
  params,
}: LocalizedCheckoutPaymentPageProps): Promise<Metadata> {
  const decodedParams = decodeCheckoutPaymentParams(await params);
  const { locale, orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale(locale, () => {
    const title = m.checkoutPaymentRetryMetadataTitle({}, { locale });
    const description = m.checkoutPaymentRetryMetadataDescription(
      {},
      { locale }
    );
    const url = getWorkspaceLocalizedCanonicalUrl(
      locale,
      `/checkout/payment/${orderId}`
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
              `/checkout/payment/${orderId}`
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

export default async function LocalizedCheckoutPaymentPage({
  params,
  searchParams,
}: LocalizedCheckoutPaymentPageProps) {
  const decodedParams = decodeCheckoutPaymentParams(await params);
  const { locale, orderId } = Option.getOrElse(decodedParams, () => notFound());

  const { outcome } = Option.getOrElse(
    decodeCheckoutPaymentSearchParams(await searchParams),
    () => ({ outcome: "unknown" as const })
  );

  await refreshStatus(orderId, outcome).catch(async (cause) => {
    await Effect.logError("Checkout status refresh failed", {
      orderId,
      outcome,
      cause,
    }).pipe(runWorkspaceEffect);
  });
  redirect(getCheckoutStatusRedirectPath({ locale, orderId, outcome }));
}
