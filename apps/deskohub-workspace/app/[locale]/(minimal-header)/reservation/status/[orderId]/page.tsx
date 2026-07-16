import { Effect, Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { env } from "@/env";
import {
  type CheckoutStatusReturnOutcome,
  getCheckoutStatus,
  refreshCheckoutStatus,
} from "@/features/checkout/backend/checkout";
import { shouldAutoRefreshCheckoutStatus } from "@/features/checkout/checkout-status-refresh-policy";
import { CheckoutStatusAutoRefresh } from "@/features/checkout/components/checkout-status-auto-refresh";
import { CheckoutStatusPage } from "@/features/checkout/components/checkout-status-page";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getParamsDecoder,
  type LocalizedRoutePageWithSearchParamsProps,
} from "@/features/i18n/server/route-params";
import { runWorkspace } from "@/shared/backend/logging/censorship";
import { Container } from "@/shared/components/container";
import {
  getSearchParam,
  getSearchParamsDecoder,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

export const maxDuration = 15;

type LocalizedCheckoutStatusPageProps = LocalizedRoutePageWithSearchParamsProps<
  { readonly orderId: string },
  SearchParamsRecord
>;

const decodeCheckoutStatusParams = getParamsDecoder({
  orderId: Schema.NonEmptyString,
});

const decodeCheckoutStatusSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.Literals(["success", "cancelled"]),
  })
);

const shouldUsePreviewE2EStatusRead = (searchParams: SearchParamsRecord) =>
  env.VERCEL_ENV === "preview" &&
  getSearchParam(searchParams, "e2eState") === "fulfillmentFailed";

const loadCheckoutStatus = (input: {
  readonly orderId: string;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
  readonly searchParams: SearchParamsRecord;
}) =>
  shouldUsePreviewE2EStatusRead(input.searchParams)
    ? getCheckoutStatus(input)
    : refreshCheckoutStatus(input);

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
      `/reservation/status/${orderId}`
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
              `/reservation/status/${orderId}`
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
    <Suspense fallback={<CheckoutStatusFallback />}>
      <CheckoutStatusContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CheckoutStatusContent({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  await connection();

  const decodedParams = decodeCheckoutStatusParams(await params);
  const { locale, orderId } = Option.getOrElse(decodedParams, () => notFound());

  const rawSearchParams = await searchParams;
  const { outcome: returnOutcome } = Option.getOrElse(
    decodeCheckoutStatusSearchParams(rawSearchParams),
    () => ({ outcome: "unknown" as const })
  );
  const status = await loadCheckoutStatus({
    orderId,
    returnOutcome,
    searchParams: rawSearchParams,
  }).catch(async (cause) => {
    await Effect.logError("Checkout status load failed", {
      orderId,
      returnOutcome,
      cause,
    }).pipe(runWorkspace);
    throw cause;
  });
  return runWithRequestLocale(locale, () => (
    <>
      <CheckoutStatusAutoRefresh
        enabled={shouldAutoRefreshCheckoutStatus(status.status)}
      />
      <CheckoutStatusPage locale={locale} status={status} />
    </>
  ));
}

function CheckoutStatusFallback() {
  return (
    <main className="min-h-screen overflow-x-clip bg-navy-blue text-white">
      <section className="relative isolate overflow-hidden pb-20 pt-24 sm:pb-24 sm:pt-32">
        <div className="absolute left-1/2 top-16 -z-10 h-80 w-3xl -translate-x-1/2 rotate-[-9deg] rounded-full bg-burned-orange/16 blur-3xl" />
        <div className="absolute -right-28 bottom-24 -z-10 h-72 w-72 rounded-full bg-aquamarine-green/14 blur-3xl" />

        <Container className="max-w-4xl">
          <div className="mx-auto max-w-3xl flex flex-col gap-6">
            <div className="grid gap-2 sm:grid-cols-3" aria-hidden="true">
              <div className="h-14 rounded-2xl bg-white/7" />
              <div className="h-14 rounded-2xl bg-white/7" />
              <div className="h-14 rounded-2xl bg-white/12" />
            </div>

            <div className="rounded-[2.25rem] border border-white/55 bg-white/94 p-6 shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm sm:p-10">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                <div className="h-16 w-16 shrink-0 rounded-full bg-navy-blue/8 ring-8 ring-navy-blue/6" />
                <div className="min-w-0 flex-1 space-y-5">
                  <div className="h-4 w-40 rounded-full bg-burned-orange/18" />
                  <div className="h-12 w-full max-w-lg rounded-2xl bg-navy-blue/8" />
                  <div className="h-5 w-full max-w-xl rounded-full bg-navy-blue/8" />
                  <div className="h-5 w-3/4 rounded-full bg-navy-blue/8" />
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </main>
  );
}
