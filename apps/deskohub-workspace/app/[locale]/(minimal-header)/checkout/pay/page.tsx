import { Effect, Option } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  buildCheckoutPayContinuationPath,
  discountCodeErrorQueryParam,
  getSignedPayStateCheckoutSummary,
  getSignedPayStateSubmittedCodeApplication,
  openPayState,
  PayableReservationService,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import { CheckoutDiscountCodeForm } from "@/features/checkout/components/checkout-discount-code-form";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { CheckoutPayPage } from "@/features/checkout/components/checkout-pay-page";
import { getDiscountCodeEntryEnabled } from "@/features/discounts/discount-code-entry.server";
import { isLocale, type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
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
  const resolvedSearchParams = await searchParams;
  const payStateToken = getSearchParam(
    resolvedSearchParams,
    payStateTokenQueryParam
  );
  const discountCodeError =
    getSearchParam(resolvedSearchParams, discountCodeErrorQueryParam) ===
    "unavailable";

  if (!payStateToken) {
    return runWithRequestLocale(locale, () => (
      <InvalidPayState locale={locale} />
    ));
  }

  const opened = await Effect.gen(function* () {
    const payableReservations = yield* PayableReservationService;
    const state = yield* openPayState(payStateToken);
    const discountCodeEntryEnabled = yield* getDiscountCodeEntryEnabled;
    const freshPayUrl = yield* buildCheckoutPayContinuationPath(state).pipe(
      Effect.when(Effect.succeed(state.changedKeys !== undefined)),
      Effect.map(Option.getOrUndefined)
    );

    yield* payableReservations.requireCurrent({
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
    });

    return { state, freshPayUrl, discountCodeEntryEnabled };
  }).pipe(
    Effect.provide(PayableReservationService.LiveWithDependencies),
    Effect.catch((cause) =>
      Effect.logWarning("Checkout pay state could not be loaded", {
        cause,
        reason: "payStateUnavailable",
      }).pipe(Effect.as(undefined))
    ),
    runWorkspaceEffect("checkout.pay.load")
  );

  if (!opened || opened.state.locale !== locale) {
    return runWithRequestLocale(locale, () => (
      <InvalidPayState locale={locale} />
    ));
  }

  const { discountCodeEntryEnabled, freshPayUrl, state } = opened;
  const submittedCodeApplication =
    getSignedPayStateSubmittedCodeApplication(state);

  return runWithRequestLocale(locale, () => (
    <CheckoutFlowLayout
      activeStepKey="pay"
      locale={locale}
      stepHrefs={{
        order: `/${locale}/checkout/order?${new URLSearchParams({
          [payStateTokenQueryParam]: payStateToken,
        })}`,
      }}
    >
      <CheckoutPayPage
        changedKeys={state.changedKeys}
        discountCodeForm={
          <CheckoutDiscountCodeForm
            appliedAdjustment={submittedCodeApplication?.discount.adjustment}
            enabled={
              discountCodeEntryEnabled && state.submittedCode === undefined
            }
            fieldError={discountCodeError}
            locale={locale}
            payStateToken={payStateToken}
          />
        }
        freshPayUrl={freshPayUrl}
        locale={locale}
        payStateToken={state.changedKeys ? undefined : payStateToken}
        summary={getSignedPayStateCheckoutSummary(state)}
        variant={state.changedKeys ? "pricingChanged" : "pay"}
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
