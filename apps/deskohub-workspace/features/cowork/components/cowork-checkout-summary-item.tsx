import type { CheckoutSummaryOrderItem } from "@/features/checkout/checkout-summary";
import { CheckoutSummaryProductLine } from "@/features/checkout/components/checkout-summary-line";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import type { Locale } from "@/features/i18n";

type CoworkCheckoutSummaryItem = Extract<
  CheckoutSummaryOrderItem,
  { readonly product: { readonly kind: "cowork" } }
>;

export function CoworkCheckoutSummaryItem({
  changed,
  item,
  locale,
}: {
  readonly changed?: boolean;
  readonly item: CoworkCheckoutSummaryItem;
  readonly locale: Locale;
}) {
  return (
    <CheckoutSummaryProductLine
      changed={changed}
      item={item}
      label={getWorkspaceProductTierTitle(item.product.tier, locale)}
      locale={locale}
    />
  );
}
