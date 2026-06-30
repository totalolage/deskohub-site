import { Effect } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  openPayState,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/pay-state.server";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { CheckoutPayPage } from "@/features/checkout/components/checkout-pay-page";
import { isLocale, type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  getSearchParam,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

type LocalizedCheckoutPayPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

export async function generateMetadata({
  params,
}: LocalizedCheckoutPayPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.checkoutPayMetadataTitle({}, { locale });
    const description = m.checkoutPayMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(locale, "/checkout/pay");

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(itemLocale, "/checkout/pay"),
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

export default async function LocalizedCheckoutPayPage({
  params,
  searchParams,
}: LocalizedCheckoutPayPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => (
    <Suspense fallback={null}>
      <CheckoutPayContent locale={locale} searchParams={searchParams} />
    </Suspense>
  ));
}

async function CheckoutPayContent({
  locale,
  searchParams,
}: {
  readonly locale: Locale;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  await connection();
  const payStateToken = getSearchParam(
    await searchParams,
    payStateTokenQueryParam
  );

  if (!payStateToken) {
    return runWithRequestLocale(locale, () => (
      <InvalidPayState locale={locale} />
    ));
  }

  const state = await Promise.resolve()
    .then(() => openPayState(payStateToken))
    .catch(async (cause) => {
      await Effect.logWarning("Checkout pay state token could not be opened", {
        cause,
        payStateToken,
        reason: "openPayStateFailed",
      }).pipe(runWorkspaceEffect);
      return undefined;
    });

  if (!state || state.locale !== locale) {
    return runWithRequestLocale(locale, () => (
      <InvalidPayState locale={locale} />
    ));
  }

  return runWithRequestLocale(locale, () => (
    <CheckoutFlowLayout activeStepKey="pay" locale={locale}>
      <CheckoutPayPage
        locale={locale}
        payStateToken={payStateToken}
        summary={state.quote.summary}
        variant="pay"
      />
    </CheckoutFlowLayout>
  ));
}

function InvalidPayState({ locale }: { readonly locale: Locale }) {
  return (
    <CheckoutFlowLayout activeStepKey="pay" locale={locale}>
      <Card className="relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm">
        <CardHeader className="space-y-3 pb-6">
          <CardTitle className="text-3xl sm:text-[2.35rem]">
            {m.checkoutPayInvalidStateTitle({}, { locale })}
          </CardTitle>
          <CardDescription className="max-w-2xl font-mono text-9xl text-center leading-96 text-navy-blue/50 sm:text-8xl">
            {m.checkoutPayInvalidStateLead({}, { locale })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            asChild
            className="h-13 w-full rounded-full text-sm uppercase tracking-[0.18em]"
          >
            <Link href={`/${locale}/checkout/order`}>
              {m.checkoutPayRestartButton({}, { locale })}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </CheckoutFlowLayout>
  );
}
