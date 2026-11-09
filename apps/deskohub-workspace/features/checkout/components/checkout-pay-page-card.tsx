"use client";

import Interpolate from "@doist/react-interpolate";
import { CreditCard, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { type Locale, m } from "@/features/i18n";
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
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import { formatMoney, type Money } from "@/shared/money/money";

type CheckoutPayActionVariant = "pay" | "retry";

export function CheckoutPayCard({
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
        <CardTitle as="h1" className="text-3xl sm:text-[2.35rem]">
          {title}
        </CardTitle>
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

export function CheckoutPayConsent({
  checked,
  disabled,
  id,
  locale,
  onCheckedChange,
  showEarlyPerformanceRequest = false,
  variant,
}: {
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly id: string;
  readonly locale: Locale;
  readonly onCheckedChange?: (checked: boolean) => void;
  readonly showEarlyPerformanceRequest?: boolean;
  readonly variant: CheckoutPayActionVariant;
}) {
  return (
    <ChoiceCard htmlFor={id}>
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
      <span className="text-sm leading-6 text-navy-blue/66">
        <Interpolate
          string={
            {
              pay: m.checkoutPayConsent({}, { locale }),
              retry: m.checkoutPaymentRetryConsent({}, { locale }),
            }[variant]
          }
          mapping={{
            terms: (label) => (
              <LegalLink
                href={`/${locale}/terms-and-conditions`}
                label={label}
              />
            ),
            operatingRules: (label) => (
              <LegalLink href={`/${locale}/operating-rules`} label={label} />
            ),
            earlyPerformance: (text) =>
              showEarlyPerformanceRequest ? text : null,
          }}
        />
      </span>
    </ChoiceCard>
  );
}

/** Tells the customer, and any agent acting for them, who takes the payment. */
export function CheckoutPayProviderHandoff({
  locale,
}: {
  readonly locale: Locale;
}) {
  return (
    <p className="flex items-start gap-2 text-sm leading-6 text-navy-blue/66">
      <ShieldCheck
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-aquamarine-ink"
      />
      <span>{m.checkoutPayProviderHandoff({}, { locale })}</span>
    </p>
  );
}

export function CheckoutPaySubmitButton({
  disabled,
  locale,
  onClick,
  pending,
  total,
  variant,
}: {
  readonly disabled?: boolean;
  readonly locale: Locale;
  readonly onClick?: () => void;
  readonly pending?: boolean;
  /** The amount the provider charges; a free order omits it. */
  readonly total?: Money;
  readonly variant: CheckoutPayActionVariant;
}) {
  return (
    <Button
      type="button"
      size="xl"
      caps
      fullWidth
      disabled={disabled}
      pending={pending}
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
          {total
            ? m.checkoutPayOrderAndPayAmountButton(
                { amount: formatMoney(total, locale) },
                { locale }
              )
            : m.checkoutPayOrderAndPayButton({}, { locale })}
        </>
      )}
    </Button>
  );
}

function LegalLink({
  href,
  label,
}: {
  readonly href: string;
  readonly label: ReactNode;
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
