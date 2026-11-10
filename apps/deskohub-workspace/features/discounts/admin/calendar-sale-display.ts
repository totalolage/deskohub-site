import { m } from "@/features/administration/i18n";
import {
  type DiscountLabels,
  discountLabelFor,
} from "@/features/discounts/discount-label";
import type { StoredDiscountId } from "@/features/discounts/persistence-contracts";
import type { Locale } from "@/features/i18n";
import type { AdminCalendarSale } from "./discount-administration.service";

type CalendarSaleAssociation = AdminCalendarSale["association"];
type CalendarSaleDiscount = {
  readonly labels: DiscountLabels;
};

/** A Calendar event status in the operator's locale; unknown values show as sent. */
export const getCalendarStatusLabel = (status: string, locale: Locale) => {
  switch (status) {
    case "confirmed":
      return m.discountsCalendarStatusConfirmed({}, { locale });
    case "tentative":
      return m.discountsCalendarStatusTentative({}, { locale });
    case "cancelled":
      return m.discountsCalendarStatusCancelled({}, { locale });
    case "unknown":
      return m.discountsCalendarStatusUnknown({}, { locale });
    default:
      return status;
  }
};

/** The listed discount a Calendar sale points at, if it points at one. */
export const findCalendarSaleDiscount = <Discount>(
  association: CalendarSaleAssociation,
  discountsById: ReadonlyMap<StoredDiscountId, Discount>
) =>
  association.kind === "associated"
    ? discountsById.get(association.discountId)
    : undefined;

/**
 * The associated discount's label in the operator's locale, falling back to
 * the label the server resolved when the discount is not in the list.
 */
export const getCalendarSaleDiscountLabel = (
  association: Extract<CalendarSaleAssociation, { kind: "associated" }>,
  discountsById: ReadonlyMap<StoredDiscountId, CalendarSaleDiscount>,
  locale: Locale
) => {
  const discount = discountsById.get(association.discountId);
  return discount
    ? discountLabelFor(discount.labels, locale)
    : association.discountLabel;
};
