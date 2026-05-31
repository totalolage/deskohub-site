"use client";

import { AlertTriangle, CreditCard, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import type {
  CheckoutSummaryChangedKeys,
  CheckoutSummary as CheckoutSummaryData,
} from "@/features/checkout/checkout-quote";
import { CheckoutSummary } from "@/features/checkout/components/checkout-summary";
import { type Locale, m } from "@/features/i18n";
import { submitReservation } from "@/features/reservation/actions/submit-reservation";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { cn } from "@/shared/utils";

type CheckoutPayPageProps = {
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly freshPayUrl?: string;
  readonly locale: Locale;
  readonly orderId?: string;
  readonly payStateToken?: string;
  readonly summary: CheckoutSummaryData;
  readonly variant: "pay" | "retry" | "pricingChanged";
  readonly retryOutcome?: "cancelled" | "failed";
};

export function CheckoutPayPage({
  changedKeys,
  freshPayUrl,
  locale,
  orderId,
  payStateToken,
  retryOutcome,
  summary,
  variant,
}: CheckoutPayPageProps) {
  const router = useRouter();
  const [legalConsent, setLegalConsent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { execute, isExecuting } = useAction(submitReservation, {
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

      router.push(data.redirectUrl);
    },
    onError: ({ error }) => {
      setErrorMessage(
        error.serverError || m.checkoutPaySubmitError({}, { locale })
      );
    },
  });
  const isPricingChanged = variant === "pricingChanged";
  const title = isPricingChanged
    ? m.checkoutPayPricingChangedTitle({}, { locale })
    : variant === "retry"
      ? m.checkoutPaymentRetryTitle({}, { locale })
      : m.checkoutPayTitle({}, { locale });
  const lead = isPricingChanged
    ? m.checkoutPayPricingChangedLead({}, { locale })
    : variant === "retry"
      ? m.checkoutPaymentRetryLead({}, { locale })
      : null;

  return (
    <Card className="relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      <CardHeader className="space-y-3 pb-6">
        {orderId ? (
          <div className="w-fit rounded-full border border-burned-orange/20 bg-burned-orange/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-burned-orange">
            {orderId}
          </div>
        ) : null}
        <CardTitle className="text-3xl sm:text-[2.35rem]">{title}</CardTitle>
        {lead ? (
          <CardDescription className="max-w-2xl text-base leading-7 text-navy-blue/72">
            {lead}
          </CardDescription>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-6">
        {retryOutcome ? (
          <Banner>
            {retryOutcome === "cancelled"
              ? m.checkoutPaymentRetryCancelledBanner({}, { locale })
              : m.checkoutPaymentRetryFailedBanner({}, { locale })}
          </Banner>
        ) : null}

        {isPricingChanged ? (
          <Banner>{m.checkoutPayPricingChangedBanner({}, { locale })}</Banner>
        ) : null}

        <CheckoutSummary
          changedKeys={changedKeys}
          locale={locale}
          summary={summary}
        />

        {isPricingChanged ? (
          <Button
            asChild
            className="h-13 w-full rounded-full text-sm uppercase tracking-[0.18em]"
          >
            <Link href={freshPayUrl ?? `/${locale}/checkout/order`}>
              {m.checkoutPayReviewUpdatedPriceButton({}, { locale })}
            </Link>
          </Button>
        ) : (
          <>
            <label
              htmlFor="checkout-pay-legal-consent"
              className="flex cursor-pointer items-start gap-3 rounded-[1.35rem] border border-navy-blue/10 bg-navy-blue/2.5 p-4"
            >
              <Checkbox
                id="checkout-pay-legal-consent"
                className="mt-1"
                checked={legalConsent}
                onCheckedChange={(checked) => setLegalConsent(Boolean(checked))}
              />
              <span className="space-y-2 text-sm leading-6 text-navy-blue/66">
                <span className="block">
                  {variant === "retry"
                    ? m.checkoutPaymentRetryConsentBefore({}, { locale })
                    : m.checkoutPayConsentBefore({}, { locale })}{" "}
                  <LegalLink
                    href={`/${locale}/terms-and-conditions`}
                    label={m.reservationLegalConsentTermsLink({}, { locale })}
                  />
                  {", "}
                  <LegalLink
                    href={`/${locale}/operating-rules`}
                    label={m.reservationLegalConsentOperatingRulesLink(
                      {},
                      { locale }
                    )}
                  />{" "}
                  {m.reservationLegalConsentAnd({}, { locale })}{" "}
                  <LegalLink
                    href={`/${locale}/privacy-policy`}
                    label={m.reservationLegalConsentPrivacyLink({}, { locale })}
                  />
                  . {m.reservationLegalConsentNoRefund({}, { locale })}
                </span>
              </span>
            </label>

            <Button
              type="button"
              className="h-13 w-full rounded-full text-sm uppercase tracking-[0.18em]"
              disabled={!legalConsent || isExecuting}
              onClick={() => {
                setErrorMessage(null);
                if (!payStateToken) {
                  setErrorMessage(m.checkoutPaySubmitError({}, { locale }));
                  return;
                }

                execute({
                  locale,
                  payStateToken,
                  legalConsent,
                });
              }}
            >
              {isExecuting ? (
                m.checkoutPaymentRetryPending({}, { locale })
              ) : (
                <>
                  {variant === "retry" ? (
                    <RotateCcw className="h-4 w-4" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  {m.checkoutPayOrderAndPayButton({}, { locale })}
                </>
              )}
            </Button>
          </>
        )}

        {!!errorMessage && <Banner>{errorMessage}</Banner>}
      </CardContent>
    </Card>
  );
}

function Banner({ children }: { readonly children: string }) {
  return (
    <p
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm leading-6",
        "border-burned-orange/20 bg-burned-orange/8 text-navy-blue"
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
      <span>{children}</span>
    </p>
  );
}

function LegalLink({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
    >
      {label}
    </Link>
  );
}
