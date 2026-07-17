"use client";

import { Match } from "effect";
import { Info } from "lucide-react";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-quote";
import {
  formatWorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

const formatDiscountAdjustment = (
  discount: CheckoutSummaryDiscount["discount"],
  locale: Locale
) =>
  Match.value(discount.adjustment).pipe(
    Match.discriminatorsExhaustive("kind")({
      percentage: ({ basisPoints }) =>
        new Intl.NumberFormat(locale, {
          style: "percent",
          maximumFractionDigits: 2,
        }).format(basisPoints / 10_000),
      fixed: ({ amount }) => formatWorkspaceMoney(amount, locale),
    })
  );

export function CheckoutSummaryDiscountDetails({
  discounts,
  locale,
  productLabel,
}: {
  readonly discounts: readonly CheckoutSummaryDiscount[];
  readonly locale: Locale;
  readonly productLabel: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={m.checkoutSummaryDiscountDetailsTrigger(
              { product: productLabel },
              { locale }
            )}
            className="h-8 w-8 shrink-0 rounded-full p-0 text-navy-blue/60"
          >
            <Info aria-hidden="true" className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          align="end"
          collisionPadding={16}
          className="w-[min(20rem,calc(100vw-2rem))] p-4"
          side="top"
        >
          <CheckoutSummaryDiscountDetailsContent
            discounts={discounts}
            locale={locale}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CheckoutSummaryDiscountDetailsContent({
  discounts,
  locale,
}: {
  readonly discounts: readonly CheckoutSummaryDiscount[];
  readonly locale: Locale;
}) {
  return (
    <ul className="space-y-3">
      {discounts.map(({ amount, discount }) => (
        <li
          key={discount.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 text-sm"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{discount.label}</span>
            <span className="block text-xs text-navy-blue/55">
              {formatDiscountAdjustment(discount, locale)}
            </span>
          </span>
          <span className="font-semibold tabular-nums">
            {formatWorkspaceMoney(
              workspaceMoneyWithValue(-amount.value, amount),
              locale
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
