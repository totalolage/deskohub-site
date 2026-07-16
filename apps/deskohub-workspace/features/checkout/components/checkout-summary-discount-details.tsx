"use client";

import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-quote";
import {
  formatWorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";

const hoverCloseDelayMilliseconds = 120;

const formatDiscountAdjustment = (
  discount: CheckoutSummaryDiscount["discount"],
  locale: Locale
) =>
  discount.adjustment.kind === "percentage"
    ? new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(discount.adjustment.basisPoints / 10_000)
    : formatWorkspaceMoney(discount.adjustment.amount, locale);

export function CheckoutSummaryDiscountDetails({
  discounts,
  locale,
  productLabel,
}: {
  readonly discounts: readonly CheckoutSummaryDiscount[];
  readonly locale: Locale;
  readonly productLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pinnedRef = useRef(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cancelScheduledClose = () => {
    if (closeTimeoutRef.current !== undefined) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = undefined;
    }
  };

  const openForPreview = () => {
    cancelScheduledClose();
    setOpen(true);
  };

  const schedulePreviewClose = () => {
    cancelScheduledClose();
    if (pinnedRef.current) return;

    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = undefined;
    }, hoverCloseDelayMilliseconds);
  };

  useEffect(
    () => () => {
      if (closeTimeoutRef.current !== undefined) {
        clearTimeout(closeTimeoutRef.current);
      }
    },
    []
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) pinnedRef.current = false;
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={m.checkoutSummaryDiscountDetailsTrigger(
            { product: productLabel },
            { locale }
          )}
          aria-expanded={open}
          className="h-8 w-8 shrink-0 rounded-full p-0 text-navy-blue/60"
          onClick={(event) => {
            event.preventDefault();
            cancelScheduledClose();
            pinnedRef.current = !pinnedRef.current;
            setOpen(pinnedRef.current);
          }}
          onFocus={openForPreview}
          onBlur={schedulePreviewClose}
          onPointerEnter={openForPreview}
          onPointerLeave={schedulePreviewClose}
        >
          <Info aria-hidden="true" className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="w-[min(20rem,calc(100vw-2rem))]"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={cancelScheduledClose}
        onPointerLeave={schedulePreviewClose}
      >
        <CheckoutSummaryDiscountDetailsContent
          discounts={discounts}
          locale={locale}
        />
      </PopoverContent>
    </Popover>
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
    <>
      <h3 className="text-sm font-semibold">
        {m.checkoutSummaryDiscountDetailsTitle({}, { locale })}
      </h3>
      <ul className="mt-3 space-y-3">
        {discounts.map(({ amount, discount }) => (
          <li
            key={discount.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 text-sm"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">
                {discount.label}
              </span>
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
    </>
  );
}
