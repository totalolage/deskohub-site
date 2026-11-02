"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type {
  CheckoutSummaryChangedKeys,
  CheckoutSummary as CheckoutSummaryData,
} from "@/features/checkout/checkout-summary";
import { CheckoutDiscountCountdownBanner } from "@/features/checkout/components/checkout-discount-countdown-banner";
import { CheckoutSummary } from "@/features/checkout/components/checkout-summary";
import { type Locale, m } from "@/features/i18n";
import { getCoworkReservationPath } from "@/features/reservation/routes";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import {
  CheckoutPayCard,
  CheckoutPayConsent,
  CheckoutPayProviderHandoff,
  CheckoutPaySubmitButton,
} from "./checkout-pay-page-card";
import { useCheckoutPaySubmission } from "./use-checkout-pay-submission";

type CheckoutPayPageProps = {
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly discountCodeForm?: ReactNode;
  readonly earlyPerformanceRequestRequired?: boolean;
  readonly freshPayUrl?: string;
  readonly locale: Locale;
  readonly payStateToken?: string;
  readonly summary: CheckoutSummaryData;
  readonly variant: "pay" | "retry" | "pricingChanged";
  readonly retryOutcome?: "cancelled" | "failed";
};

export function CheckoutPayPage({
  changedKeys,
  discountCodeForm,
  earlyPerformanceRequestRequired = true,
  freshPayUrl,
  locale,
  payStateToken,
  retryOutcome,
  summary,
  variant,
}: CheckoutPayPageProps) {
  const {
    errorMessage,
    isSubmitPending,
    legalConsent,
    setLegalConsent,
    submit,
  } = useCheckoutPaySubmission({
    earlyPerformanceRequestRequired,
    locale,
    payStateToken,
  });
  const isPricingChanged = variant === "pricingChanged";
  const title = {
    pay: m.checkoutPayTitle({}, { locale }),
    retry: m.checkoutPaymentRetryTitle({}, { locale }),
    pricingChanged: m.checkoutPayPricingChangedTitle({}, { locale }),
  }[variant];
  const lead = {
    pay: null,
    retry: m.checkoutPaymentRetryLead({}, { locale }),
    pricingChanged: m.checkoutPayPricingChangedLead({}, { locale }),
  }[variant];
  const actionVariant = (
    {
      pay: "pay",
      retry: "retry",
      pricingChanged: "pay",
    } as const
  )[variant];
  // A free order completes without the payment provider.
  const providerTotal = summary.total.value > 0 ? summary.total : undefined;

  return (
    <CheckoutPayCard lead={lead} title={title}>
      <CheckoutPayNotices
        isPricingChanged={isPricingChanged}
        locale={locale}
        retryOutcome={retryOutcome}
      />

      <CheckoutDiscountCountdownBanner locale={locale} summary={summary} />

      <CheckoutSummary
        changedKeys={changedKeys}
        locale={locale}
        summary={summary}
      />

      {variant === "pay" && discountCodeForm}

      {isPricingChanged ? (
        <CheckoutPayUpdatedPriceLink
          freshPayUrl={freshPayUrl}
          locale={locale}
        />
      ) : (
        <>
          {!!providerTotal && <CheckoutPayProviderHandoff locale={locale} />}

          <CheckoutPayConsent
            checked={legalConsent}
            id="checkout-pay-legal-consent"
            locale={locale}
            onCheckedChange={setLegalConsent}
            showEarlyPerformanceRequest={earlyPerformanceRequestRequired}
            variant={actionVariant}
          />

          <CheckoutPaySubmitButton
            disabled={!legalConsent || isSubmitPending}
            locale={locale}
            onClick={submit}
            pending={isSubmitPending}
            total={providerTotal}
            variant={actionVariant}
          />
        </>
      )}

      {!!errorMessage && <Banner role="alert">{errorMessage}</Banner>}
    </CheckoutPayCard>
  );
}

/** Why the customer is back on the Pay page, when they are. */
function CheckoutPayNotices({
  isPricingChanged,
  locale,
  retryOutcome,
}: {
  readonly isPricingChanged: boolean;
  readonly locale: Locale;
  readonly retryOutcome: CheckoutPayPageProps["retryOutcome"];
}) {
  return (
    <>
      {!!retryOutcome && (
        <Banner>
          {
            {
              cancelled: m.checkoutPaymentRetryCancelledBanner({}, { locale }),
              failed: m.checkoutPaymentRetryFailedBanner({}, { locale }),
            }[retryOutcome]
          }
        </Banner>
      )}

      {isPricingChanged && (
        <Banner>{m.checkoutPayPricingChangedBanner({}, { locale })}</Banner>
      )}
    </>
  );
}

function CheckoutPayUpdatedPriceLink({
  freshPayUrl,
  locale,
}: {
  readonly freshPayUrl: string | undefined;
  readonly locale: Locale;
}) {
  return (
    <Button asChild size="xl" caps fullWidth>
      <Link
        href={freshPayUrl ?? getCoworkReservationPath(locale)}
        prefetch={false}
      >
        {m.checkoutPayReviewUpdatedPriceButton({}, { locale })}
      </Link>
    </Button>
  );
}

function Banner({
  children,
  role,
}: {
  readonly children: string;
  readonly role?: "alert";
}) {
  return (
    <p
      // A banner inserted after a failed action must use an alert role:
      // assistive technology may ignore a live region mounted with content.
      {...(role ? { role } : { "aria-live": "polite" as const })}
      className={cn(
        "flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm leading-6",
        "border-burned-orange/20 bg-burned-orange/8 text-burned-orange-ink"
      )}
    >
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange"
      />
      <span>{children}</span>
    </p>
  );
}
