import type { CheckoutSummaryOrderItem } from "@/features/checkout/checkout-summary";
import { CheckoutSummaryProductLine } from "@/features/checkout/components/checkout-summary-line";
import { getWorkspaceMeetingRoomDurationTitle } from "@/features/checkout/product-catalog.i18n";
import type { Locale } from "@/features/i18n";

type MeetingRoomCheckoutSummaryItem = Extract<
  CheckoutSummaryOrderItem,
  { readonly product: { readonly kind: "meeting-room" } }
>;

export function MeetingRoomCheckoutSummaryItem({
  changed,
  item,
  locale,
}: {
  readonly changed?: boolean;
  readonly item: MeetingRoomCheckoutSummaryItem;
  readonly locale: Locale;
}) {
  return (
    <CheckoutSummaryProductLine
      changed={changed}
      item={item}
      label={getWorkspaceMeetingRoomDurationTitle(
        item.product.duration,
        locale
      )}
      locale={locale}
    />
  );
}
