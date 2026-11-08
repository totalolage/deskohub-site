import { Effect, Layer, Option } from "effect";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  buildCheckoutPayContinuationPath,
  discountCodeErrorIdQueryParam,
  discountCodeErrorQueryParam,
  getPayStateRestartKind,
  getSignedPayStateCheckoutSummary,
  getSignedPayStateSubmittedCodeApplication,
  openPayState,
  PayableReservationService,
  payStateContinuesOn,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import {
  checkoutReferralAppliedQueryParam,
  hasCheckoutReferralAppliedNotice,
} from "@/features/checkout/checkout-referral-notice";
import { CheckoutDiscountCodeForm } from "@/features/checkout/components/checkout-discount-code-form";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { CheckoutPayPage } from "@/features/checkout/components/checkout-pay-page";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page-skeleton";
import { parseDiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import { getDiscountCodeEntryEnabled } from "@/features/discounts/discount-code-entry.server";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getEarlyPerformanceRequestRequiredAt,
  isEarlyPerformanceRequestRequired,
} from "@/features/legal/early-performance";
import { createNoindexedPageMetadata } from "@/features/public-pages/page-metadata";
import { reservationCheckoutStepQueryParam } from "@/features/reservation/reservation-checkout-step";
import {
  getCoworkReservationPath,
  getReservationStartPath,
} from "@/features/reservation/routes";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { RouteAutoRefresh } from "@/shared/components/route-auto-refresh";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { getSearchParam, type SearchParamsRecord } from "@/shared/utils";

type SignedPayState = Effect.Success<ReturnType<typeof openPayState>>;

type LocalizedCheckoutPayPageProps = {
  searchParams: Promise<SearchParamsRecord>;
};

// Keep the pay route non-instant: it is reached from a Server Action redirect,
// and making its intermediate shell interactive can let a follow-up navigation
// race the still-settling checkout transition.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createNoindexedPageMetadata({
      locale,
      title: { absolute: m.checkoutPayMetadataTitle({}, { locale }) },
      description: m.checkoutPayMetadataDescription({}, { locale }),
    })
  );
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

/**
 * The Pay state behind `payStateToken`, or none with the reservation kind to
 * restart when the token can still name one.
 */
const openCheckoutPayState = (payStateToken: string) =>
  openPayState(payStateToken).pipe(
    Effect.map((state) => ({
      state,
      restartKind: state.reservation.kind,
    })),
    // A key ring that can't be read leaves the token unreadable, like any
    // other failure to open it.
    Effect.provide(SealedStateKeys.Default),
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
            Effect.provide(SealedStateKeys.Default),
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

type PayableCheckout = Exclude<
  Awaited<ReturnType<typeof loadPayableCheckout>>,
  undefined
>;

/**
 * The held reservation the Pay state still pays for, with what the page needs
 * alongside it, or none once the state can no longer be paid.
 */
const loadPayableCheckout = (state: SignedPayState) =>
  Effect.Do.pipe(
    Effect.bind("payableReservations", () => PayableReservationService),
    Effect.bind("currentReservation", ({ payableReservations }) =>
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
    Effect.map(
      ({ currentReservation, discountCodeEntryEnabled, freshPayUrl }) => ({
        currentReservation,
        discountCodeEntryEnabled,
        freshPayUrl,
      })
    ),
    Effect.provide(
      Layer.merge(PayableReservationService.Live, SealedStateKeys.Default)
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Checkout pay state could not be loaded", {
        cause,
        reason: "payStateUnavailable",
      }).pipe(Effect.as(undefined))
    ),
    runWorkspaceEffect("checkout.pay.load")
  );

/** Where a customer with an unusable Pay state starts their order again. */
const getPayRestartPath = (
  locale: Locale,
  restartKind: SignedPayState["reservation"]["kind"] | undefined
) =>
  Option.fromNullishOr(restartKind).pipe(
    Option.map((reservationKind) =>
      getReservationStartPath(locale, reservationKind)
    ),
    Option.getOrElse(() => getCoworkReservationPath(locale))
  );

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

  if (!payStateToken) {
    return runWithRequestLocale(() => (
      <InvalidPayState
        locale={locale}
        restartPath={getCoworkReservationPath(locale)}
      />
    ));
  }

  const { state, restartKind } = await openCheckoutPayState(payStateToken);
  const restartPath = getPayRestartPath(locale, restartKind);
  if (!state || !payStateContinuesOn(state, { locale })) {
    return runWithRequestLocale(() => (
      <InvalidPayState locale={locale} restartPath={restartPath} />
    ));
  }

  const payableCheckout = await loadPayableCheckout(state);
  if (!payableCheckout) {
    return runWithRequestLocale(() => (
      <InvalidPayState locale={locale} restartPath={restartPath} />
    ));
  }

  return runWithRequestLocale(() =>
    renderCheckoutPay({
      locale,
      payableCheckout,
      payStateToken,
      searchParams: resolvedSearchParams,
      state,
    })
  );
}

type CheckoutPayRenderInput = {
  readonly locale: Locale;
  readonly payableCheckout: PayableCheckout;
  readonly payStateToken: string;
  readonly searchParams: SearchParamsRecord;
  readonly state: SignedPayState;
};

/** The Pay step for a Pay state whose reservation is still held. */
function renderCheckoutPay(input: CheckoutPayRenderInput) {
  const { locale, payableCheckout, payStateToken, state } = input;
  const orderPath = getReservationStartPath(
    locale,
    state.reservation.kind,
    new URLSearchParams({ [payStateTokenQueryParam]: payStateToken })
  );
  const contactPath = getReservationStartPath(
    locale,
    state.reservation.kind,
    new URLSearchParams({
      [payStateTokenQueryParam]: payStateToken,
      [reservationCheckoutStepQueryParam]: "contact",
    })
  );
  const earlyPerformanceRequestRequired = isEarlyPerformanceRequestRequired({
    reservation: state.reservation,
    contractAt: Temporal.Now.instant(),
  });

  return (
    <CheckoutFlowLayout
      activeStepKey="pay"
      locale={locale}
      stepLinks={{
        chooseSpace: { href: orderPath, navigation: "document" },
        contact: { href: contactPath, navigation: "document" },
      }}
    >
      {!earlyPerformanceRequestRequired && (
        <RouteAutoRefresh
          enabled={false}
          intervalMs={60_000}
          refreshAt={getEarlyPerformanceRequestRequiredAt(
            state.reservation
          ).toString()}
          refreshOnFocus
        />
      )}
      <CheckoutPayPage
        changedKeys={state.changedKeys}
        discountCodeForm={renderDiscountCodeForm(input)}
        freshPayUrl={payableCheckout.freshPayUrl}
        earlyPerformanceRequestRequired={earlyPerformanceRequestRequired}
        locale={locale}
        key={earlyPerformanceRequestRequired ? "early-performance" : "standard"}
        payStateToken={state.changedKeys ? undefined : payStateToken}
        summary={getSignedPayStateCheckoutSummary(state)}
        variant={state.changedKeys ? "pricingChanged" : "pay"}
      />
    </CheckoutFlowLayout>
  );
}

/**
 * The discount code form, showing the code the Pay state carries and the
 * rejection the last submission redirected back with.
 */
function renderDiscountCodeForm({
  locale,
  payableCheckout,
  payStateToken,
  searchParams,
  state,
}: CheckoutPayRenderInput) {
  const submittedCodeApplication =
    getSignedPayStateSubmittedCodeApplication(state);
  return (
    <CheckoutDiscountCodeForm
      appliedAdjustment={submittedCodeApplication?.discount.adjustment}
      defaultCode={state.requestedDiscountCode ?? state.submittedCode}
      enabled={
        payableCheckout.discountCodeEntryEnabled &&
        state.submittedCode === undefined
      }
      locale={locale}
      payStateToken={payStateToken}
      referralApplied={hasCheckoutReferralAppliedNotice({
        discounts: state.quote.payment.discounts,
        dotyposCustomerId: payableCheckout.currentReservation.dotyposCustomerId,
        marker: searchParams[checkoutReferralAppliedQueryParam],
      })}
      rejection={parseDiscountCodeRejection(
        getSearchParam(searchParams, discountCodeErrorQueryParam)
      )}
      rejectionId={getSearchParam(searchParams, discountCodeErrorIdQueryParam)}
    />
  );
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
          <Button asChild size="xl" caps fullWidth>
            <a href={restartPath}>
              {m.checkoutPayRestartButton({}, { locale })}
            </a>
          </Button>
        </CardContent>
      </Card>
    </CheckoutFlowLayout>
  );
}
