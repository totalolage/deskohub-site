"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import type {
  CheckoutSummaryChangedKeys,
  CheckoutSummary as CheckoutSummaryData,
} from "@/features/checkout/checkout-summary";
import { CheckoutDiscountCountdownBanner } from "@/features/checkout/components/checkout-discount-countdown-banner";
import { markCheckoutStatusWindowOwner } from "@/features/checkout/components/checkout-payment-window";
import { CheckoutSummary } from "@/features/checkout/components/checkout-summary";
import { type Locale, m } from "@/features/i18n";
import { submitReservation } from "@/features/reservation/actions/submit-reservation";
import { getCoworkReservationPath } from "@/features/reservation/routes";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import {
  CheckoutPayCard,
  CheckoutPayConsent,
  CheckoutPayProviderHandoff,
  CheckoutPaySubmitButton,
} from "./checkout-pay-page-card";

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
  const router = useRouter();
  const [legalConsent, setLegalConsent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const {
    execute,
    isExecuting,
    result: submitReservationResult,
  } = useWorkspaceAction(submitReservation, {
    onSuccess: ({ data }) => {
      if (data?.status === "pricing_changed") {
        router.push(data.freshPayUrl);
        return;
      }

      if (data?.status === "in_progress") {
        setErrorMessage(m.checkoutPaySubmitError({}, { locale }));
        return;
      }

      if (!data?.redirectUrl) {
        setErrorMessage(m.checkoutPaySubmitError({}, { locale }));
        return;
      }

      if (data.statusUrl) {
        const paymentWindow = window.open(data.redirectUrl, "_blank");
        if (paymentWindow) {
          paymentWindow.opener = null;
          markCheckoutStatusWindowOwner(data.statusUrl);
          router.push(data.statusUrl);
          return;
        }
      }

      router.push(data.redirectUrl);
    },
    onError: ({ error }) => {
      setErrorMessage(
        error.serverError || m.checkoutPaySubmitError({}, { locale })
      );
    },
    onTransportError: () => {
      setErrorMessage(m.checkoutPaySubmitError({}, { locale }));
    },
  });
  const hasCheckoutRedirect =
    submitReservationResult.data?.status === "pricing_changed" ||
    submitReservationResult.data?.status === "redirect";
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
  const isSubmitPending = isExecuting || hasCheckoutRedirect;
  // A free order completes without the payment provider.
  const providerTotal = summary.total.value > 0 ? summary.total : undefined;

  return (
    <CheckoutPayCard lead={lead} title={title}>
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

      <CheckoutDiscountCountdownBanner locale={locale} summary={summary} />

      <CheckoutSummary
        changedKeys={changedKeys}
        locale={locale}
        summary={summary}
      />

      {variant === "pay" && discountCodeForm}

      {isPricingChanged ? (
        <Button asChild size="xl" caps fullWidth>
          <Link
            href={freshPayUrl ?? getCoworkReservationPath(locale)}
            prefetch={false}
          >
            {m.checkoutPayReviewUpdatedPriceButton({}, { locale })}
          </Link>
        </Button>
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
            onClick={() => {
              if (isSubmitPending) return;

              setErrorMessage(null);
              if (!payStateToken) {
                setErrorMessage(m.checkoutPaySubmitError({}, { locale }));
                return;
              }

              const input = {
                locale,
                payStateToken,
                legalConsent,
              };
              execute(
                earlyPerformanceRequestRequired
                  ? { ...input, earlyPerformanceConsent: legalConsent }
                  : input
              );
            }}
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
