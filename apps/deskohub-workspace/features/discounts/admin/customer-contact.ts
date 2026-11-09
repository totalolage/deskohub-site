import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/** A customer's email and phone on one line, or a note that Dotypos holds neither. */
export const formatDiscountAdminCustomerContact = (
  customer: { readonly email: string | null; readonly phone: string | null },
  locale: Locale
) =>
  [customer.email, customer.phone].filter(Boolean).join(" · ") ||
  m.discountsCustomerNoContactDetails({}, { locale });
