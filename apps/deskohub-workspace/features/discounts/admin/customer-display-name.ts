import type { AdministrationCustomerName } from "@/features/administration/customer-name";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/** Names a customer in the operator's language when Dotypos holds no name or contact detail for them. */
export const formatDiscountAdminCustomerName = (
  customer: AdministrationCustomerName,
  locale: Locale
) =>
  customer.hasName
    ? customer.displayName
    : m.discountsUnnamedCustomer({}, { locale });
