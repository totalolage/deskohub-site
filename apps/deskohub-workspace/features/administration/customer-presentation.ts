import type { Locale } from "@/features/i18n";
import { m } from "./i18n";

/** Names a customer in the operator's language when Dotypos holds no name for them. */
export const getAdministrationCustomerName = (
  customer: { readonly displayName: string; readonly hasName: boolean },
  locale: Locale
) =>
  customer.hasName
    ? customer.displayName
    : m.administrationCustomerUnnamed({}, { locale });
