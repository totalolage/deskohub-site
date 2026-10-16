import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/**
 * The English display name of a Dotypos customer without any name or contact
 * detail. The administration API returns it as is; screens localize it.
 */
export const unnamedCustomerDisplayName = "Unnamed customer";

export const formatDiscountAdminCustomerName = (
  displayName: string,
  locale: Locale
) =>
  displayName === unnamedCustomerDisplayName
    ? m.discountsUnnamedCustomer({}, { locale })
    : displayName;
