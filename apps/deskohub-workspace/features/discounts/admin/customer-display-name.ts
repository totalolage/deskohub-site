import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/**
 * The English display name of a Dotypos customer without any name or contact
 * detail. The administration API returns it as is; screens localize it.
 */
export const unnamedCustomerDisplayName = "Unnamed customer";

export type DiscountAdminCustomerName = {
  readonly displayName: string;
  readonly hasName: boolean;
};

/** Names a customer in the operator's language when Dotypos holds no name or contact detail for them. */
export const formatDiscountAdminCustomerName = (
  customer: DiscountAdminCustomerName,
  locale: Locale
) =>
  customer.hasName
    ? customer.displayName
    : m.discountsUnnamedCustomer({}, { locale });
