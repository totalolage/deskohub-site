"use client";

import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import type { ReservationQuotePayment } from "@/features/checkout/reservation-quote-schema";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import type { Money } from "@/shared/money/money";
import { ReservationAdvertisedPrice } from "./reservation-advertised-price";

/** A quote's advertised total, with the price before any discount. */
export const getReservationAdvertisedTotal = ({
  expectedPrice,
  undiscountedPrice,
}: Pick<ReservationQuotePayment, "expectedPrice" | "undiscountedPrice">) => ({
  amount: expectedPrice,
  ...(undiscountedPrice.value > expectedPrice.value && {
    originalAmount: undiscountedPrice,
  }),
});

/**
 * The space picked at the first step, shown at the contact-details step with
 * a way back to change it.
 */
export function ReservationSelectionSummary({
  locale,
  onChange,
  summary,
  total,
}: {
  readonly locale: Locale;
  readonly onChange: () => void;
  readonly summary: CheckoutStatusSummaryPresentation;
  readonly total?: {
    readonly amount: Money;
    readonly originalAmount?: Money;
  };
}) {
  return (
    <section
      aria-labelledby="reservation-selection-summary-heading"
      className="space-y-4 rounded-[1.4rem] border border-navy-blue/10 bg-white p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3
            className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
            id="reservation-selection-summary-heading"
          >
            {m.reservationSelectionSummaryTitle({}, { locale })}
          </h3>
          <p className="text-lg font-semibold text-navy-blue">
            {summary.reservationTitle}
          </p>
        </div>
        <Button
          className="shrink-0"
          onClick={onChange}
          type="button"
          variant="link"
        >
          {m.reservationSelectionChange({}, { locale })}
        </Button>
      </div>
      <dl className="grid gap-4 text-navy-blue sm:grid-cols-2 md:grid-cols-3">
        {summary.rows.map((row) => (
          <div key={row.label}>
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue/55">
              {row.label}
            </dt>
            <dd>{row.value}</dd>
          </div>
        ))}
        {total && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue/55">
              {m.checkoutStatusSummaryPriceLabel({}, { locale })}
            </dt>
            <dd className="font-semibold">
              <ReservationAdvertisedPrice
                amount={total.amount}
                locale={locale}
                originalAmount={total.originalAmount}
              />
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
