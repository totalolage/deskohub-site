import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  buildCheckoutPayContinuationPath,
  discountCodeErrorQueryParam,
  getPayStateRestartKind,
  getSignedPayStateCheckoutSummary,
  getSignedPayStateSubmittedCodeApplication,
  openPayState,
  PayableReservationService,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import { CheckoutDiscountCodeForm } from "@/features/checkout/components/checkout-discount-code-form";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import {
  CheckoutPayPage,
  CheckoutPayPageSkeleton,
} from "@/features/checkout/components/checkout-pay-page";
import { getDiscountCodeEntryEnabled } from "@/features/discounts/discount-code-entry.server";
import { type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getCoworkReservationPath,
  getReservationStartPath,
} from "@/features/reservation/routes";
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
  searchParams: Promise<SearchParamsRecord>;
};

// Keep the pay route non-instant: it is reached from a Server Action redirect,
// and making its intermediate shell interactive can let a follow-up navigation
// race the still-settling checkout transition.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
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
  searchParams,
}: LocalizedCheckoutPayPageProps) {
  return runWithRequestLocale((locale) => (
    <Suspense
      fallback={
        <CheckoutFlowLayout activeStepKey="pay" locale={locale}>
          <CheckoutPayPageSkeleton locale={locale} />
        </CheckoutFlowLayout>
      }
    >
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
    return runWithRequestLocale(() => (
      <InvalidPayState
        locale={locale}
        restartPath={getCoworkReservationPath(locale)}
      />
    ));
  }

  const openedPayState = await openPayState(payStateToken).pipe(
    Effect.map((state) => ({
      state,
      restartKind: state.reservation.kind,
    })),
    Effect.catch((cause) =>
      Effect.logWarning("Checkout pay state could not be loaded", {
        cause,
        reason: "payStateUnavailable",
      }).pipe(
        Effect.andThen(
          getPayStateRestartKind(payStateToken).pipe(
            Effect.map((restartKind) => ({
              state: undefined,
              restartKind,
            })),
            Effect.orElseSucceed(() => ({
              state: undefined,
              restartKind: undefined,
            }))
          )
        )
      )
    ),
    runWorkspaceEffect("checkout.pay.open")
  );
  const restartPath = Option.fromNullishOr(openedPayState.restartKind).pipe(
    Option.map((reservationKind) =>
      getReservationStartPath(locale, reservationKind)
    ),
    Option.getOrElse(() => getCoworkReservationPath(locale))
  );

  if (!openedPayState.state || openedPayState.state.locale !== locale) {
    return runWithRequestLocale(() => (
      <InvalidPayState locale={locale} restartPath={restartPath} />
    ));
  }

  const state = openedPayState.state;
  const loadedPayState = await Effect.Do.pipe(
    Effect.bind("payableReservations", () => PayableReservationService),
    Effect.tap(({ payableReservations }) =>
      payableReservations.requireCurrent({
        orderId: state.orderId,
        checkoutSessionId: state.checkoutSessionId,
      })
    ),
    Effect.bind("discountCodeEntryEnabled", () => getDiscountCodeEntryEnabled),
    Effect.bind("freshPayUrl", () =>
      buildCheckoutPayContinuationPath(state).pipe(
        Effect.when(Effect.succeed(state.changedKeys !== undefined)),
        Effect.map(Option.getOrUndefined)
      )
    ),
    Effect.map(({ discountCodeEntryEnabled, freshPayUrl }) => ({
      discountCodeEntryEnabled,
      freshPayUrl,
    })),
    Effect.provide(PayableReservationService.LiveWithDependencies),
    Effect.catch((cause) =>
      Effect.logWarning("Checkout pay state could not be loaded", {
        cause,
        reason: "payStateUnavailable",
      }).pipe(Effect.as(undefined))
    ),
    runWorkspaceEffect("checkout.pay.load")
  );

  if (!loadedPayState) {
    return runWithRequestLocale(() => (
      <InvalidPayState locale={locale} restartPath={restartPath} />
    ));
  }

  const { discountCodeEntryEnabled, freshPayUrl } = loadedPayState;
  const submittedCodeApplication =
    getSignedPayStateSubmittedCodeApplication(state);
  const orderPath = getReservationStartPath(
    locale,
    state.reservation.kind,
    new URLSearchParams({
      [payStateTokenQueryParam]: payStateToken,
    })
  );

  return runWithRequestLocale(() => (
    <CheckoutFlowLayout
      activeStepKey="pay"
      locale={locale}
      stepLinks={{
        order: {
          href: orderPath,
          navigation: "document",
        },
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

function InvalidPayState({
  locale,
  restartPath,
}: {
  readonly locale: Locale;
  readonly restartPath: string;
}) {
  return (
    <CheckoutFlowLayout activeStepKey="pay" locale={locale}>
      <Card className="relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm">
        <CardHeader className="space-y-3 pb-6">
          <CardTitle as="h1" className="text-3xl sm:text-[2.35rem]">
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
            <a href={restartPath}>
              {m.checkoutPayRestartButton({}, { locale })}
            </a>
          </Button>
        </CardContent>
      </Card>
    </CheckoutFlowLayout>
  );
}
