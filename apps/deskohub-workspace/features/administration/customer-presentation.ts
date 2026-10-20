import type { Locale } from "@/features/i18n";
import type { AdministrationCustomerMarketingConsentState } from "./customer-list-filters";
import type { AdministrationCustomerName } from "./customer-name";
import { m } from "./i18n";

/** Names a customer in the operator's language when Dotypos holds no name for them. */
export const getAdministrationCustomerName = (
  customer: AdministrationCustomerName,
  locale: Locale
) =>
  customer.hasName
    ? customer.displayName
    : m.administrationCustomerUnnamed({}, { locale });

/** Names a customer's current marketing consent state in the operator's language. */
export const getAdministrationCustomerMarketingConsentLabel = (
  state: AdministrationCustomerMarketingConsentState,
  locale: Locale
) =>
  ({
    granted: m.administrationCustomerMarketingConsentGranted,
    never: m.administrationCustomerMarketingConsentNever,
    withdrawn: m.administrationCustomerMarketingConsentWithdrawn,
  })[state]({}, { locale });
