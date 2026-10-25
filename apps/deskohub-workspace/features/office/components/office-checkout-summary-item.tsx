import type { CheckoutSummaryOrderItem } from "@/features/checkout/checkout-summary";
import { CheckoutSummaryDiscountDetails } from "@/features/checkout/components/checkout-summary-discount-details";
import { CheckoutSummaryLine } from "@/features/checkout/components/checkout-summary-line";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { moneyWithValue } from "@/shared/money/money";

type OfficeCheckoutSummaryItem = Extract<
  CheckoutSummaryOrderItem,
  { readonly product: { readonly kind: "office" } }
>;

export function OfficeCheckoutSummaryItem({
  changed,
  item,
  locale,
}: {
  readonly changed?: boolean;
  readonly item: OfficeCheckoutSummaryItem;
  readonly locale: Locale;
}) {
  const seatTotalAmount = moneyWithValue(
    item.seatAmount.value * item.seats,
    item.seatAmount
  );
  const discountAmount = item.originalAmount
    ? moneyWithValue(item.amount.value - item.originalAmount.value, item.amount)
    : undefined;

  return (
    <>
      <CheckoutSummaryLine
        amount={item.accessAmount}
        changed={changed}
        label={m.checkoutSummaryItemOfficeAccess(
          { dayCount: item.dayCount },
          { locale }
        )}
        locale={locale}
      />
      <CheckoutSummaryLine
        amount={seatTotalAmount}
        changed={changed}
        label={`${m.checkoutSummaryItemOfficeSeatCount(
          { seatCount: item.seats },
          { locale }
        )} · ${m.checkoutSummaryItemOfficeDayCount(
          { dayCount: item.dayCount },
          { locale }
        )}`}
        locale={locale}
      />
      {discountAmount && item.discounts ? (
        <CheckoutSummaryLine
          amount={discountAmount}
          changed={changed}
          label={m.checkoutSummaryItemOfficeDiscount({}, { locale })}
          locale={locale}
        >
          <CheckoutSummaryDiscountDetails
            discounts={item.discounts}
            locale={locale}
            productLabel={getWorkspaceOfficeProductTitle(locale)}
          />
        </CheckoutSummaryLine>
      ) : null}
    </>
  );
}
