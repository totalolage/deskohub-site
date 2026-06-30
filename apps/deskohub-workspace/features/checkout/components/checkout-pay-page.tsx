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
import {
  CheckoutSummary,
  CheckoutSummarySection,
  CheckoutSummarySections,
} from "@/features/checkout/components/checkout-summary";
import { type Locale, m } from "@/features/i18n";
import { submitReservation } from "@/features/reservation/actions/submit-reservation";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  type CardProps,
  CardTitle,
} from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/utils";

type CheckoutPayPageProps = {
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly freshPayUrl?: string;
  readonly locale: Locale;
  readonly payStateToken?: string;
  readonly summary: CheckoutSummaryData;
  readonly variant: "pay" | "retry" | "pricingChanged";
  readonly retryOutcome?: "cancelled" | "failed";
};

type CheckoutPayActionVariant = "pay" | "retry";

export function CheckoutPayPage({
  changedKeys,
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
  } = useAction(submitReservation, {
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
          <CheckoutPayConsent
            checked={legalConsent}
            id="checkout-pay-legal-consent"
            locale={locale}
            onCheckedChange={setLegalConsent}
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

              execute({
                locale,
                payStateToken,
                legalConsent,
              });
            }}
            pending={isSubmitPending}
            variant={actionVariant}
          />
        </>
      )}

      {!!errorMessage && <Banner>{errorMessage}</Banner>}
    </CheckoutPayCard>
  );
}

export function CheckoutPayPageSkeleton({
  locale,
}: {
  readonly locale: Locale;
}) {
  return (
    <CheckoutPayCard
      aria-busy="true"
      aria-label={m.checkoutPaymentRetryPending({}, { locale })}
      aria-live="polite"
      title={m.checkoutPayTitle({}, { locale })}
    >
      <CheckoutPaySummarySkeleton locale={locale} />
      <CheckoutPayConsent
        disabled
        id="checkout-pay-skeleton-legal-consent"
        locale={locale}
        variant="pay"
      />
      <CheckoutPaySubmitButton disabled locale={locale} variant="pay" />
    </CheckoutPayCard>
  );
}

function CheckoutPayCard({
  children,
  lead,
  title,
  ...props
}: Omit<CardProps, "className"> & {
  readonly lead?: string | null;
  readonly title: string;
}) {
  return (
    <Card
      {...props}
      className="relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm"
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      <CardHeader className="space-y-3 pb-6">
        <CardTitle className="text-3xl sm:text-[2.35rem]">{title}</CardTitle>
        {!!lead && (
          <CardDescription className="max-w-2xl text-base leading-7 text-navy-blue/72">
            {lead}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

function CheckoutPaySummarySkeleton({ locale }: { readonly locale: Locale }) {
  return (
    <CheckoutSummarySections>
      <CheckoutSummarySection locale={locale} sectionKey="order">
        <Skeleton aria-hidden="true" className="h-4 w-full rounded-full" />
        <Skeleton aria-hidden="true" className="h-4 w-11/12 rounded-full" />
        <Skeleton aria-hidden="true" className="h-4 w-4/5 rounded-full" />
      </CheckoutSummarySection>

      <CheckoutSummarySection locale={locale} sectionKey="total">
        <div className="flex items-start justify-between gap-4">
          <Skeleton aria-hidden="true" className="h-4 w-32 rounded-full" />
          <Skeleton aria-hidden="true" className="h-4 w-24 rounded-full" />
        </div>
      </CheckoutSummarySection>
    </CheckoutSummarySections>
  );
}

function CheckoutPayConsent({
  checked,
  disabled,
  id,
  locale,
  onCheckedChange,
  variant,
}: {
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly id: string;
  readonly locale: Locale;
  readonly onCheckedChange?: (checked: boolean) => void;
  readonly variant: CheckoutPayActionVariant;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-3 rounded-[1.35rem] border border-navy-blue/10 bg-navy-blue/2.5 p-4",
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
      )}
    >
      <Checkbox
        id={id}
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onCheckedChange={
          onCheckedChange
            ? (nextChecked) => onCheckedChange(Boolean(nextChecked))
            : undefined
        }
      />
      <span className="space-y-2 text-sm leading-6 text-navy-blue/66">
        <span className="block">
          {
            {
              pay: m.checkoutPayConsentBefore({}, { locale }),
              retry: m.checkoutPaymentRetryConsentBefore({}, { locale }),
            }[variant]
          }{" "}
          <LegalLink
            href={`/${locale}/terms-and-conditions`}
            label={m.reservationLegalConsentTermsLink({}, { locale })}
          />
          {", "}
          <LegalLink
            href={`/${locale}/operating-rules`}
            label={m.reservationLegalConsentOperatingRulesLink({}, { locale })}
          />
          {"."} {m.reservationLegalConsentNoRefund({}, { locale })}
        </span>
      </span>
    </label>
  );
}

function CheckoutPaySubmitButton({
  disabled,
  locale,
  onClick,
  pending,
  variant,
}: {
  readonly disabled?: boolean;
  readonly locale: Locale;
  readonly onClick?: () => void;
  readonly pending?: boolean;
  readonly variant: CheckoutPayActionVariant;
}) {
  return (
    <Button
      type="button"
      className="h-13 w-full rounded-full text-sm uppercase tracking-[0.18em]"
      disabled={disabled}
      onClick={onClick}
    >
      {pending ? (
        m.checkoutPaymentRetryPending({}, { locale })
      ) : (
        <>
          {
            {
              pay: <CreditCard className="h-4 w-4" />,
              retry: <RotateCcw className="h-4 w-4" />,
            }[variant]
          }
          {m.checkoutPayOrderAndPayButton({}, { locale })}
        </>
      )}
    </Button>
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
      prefetch={false}
      target="_blank"
      rel="noreferrer"
      className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
    >
      {label}
    </Link>
  );
}
