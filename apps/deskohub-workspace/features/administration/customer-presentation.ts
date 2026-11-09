import type { Locale } from "@/features/i18n";
import type { MarketingConsentStatus } from "@/features/legal/marketing-consent-status";
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
  state: MarketingConsentStatus,
  locale: Locale
) =>
  ({
    active: m.administrationCustomerMarketingConsentGranted,
    absent: m.administrationCustomerMarketingConsentNever,
    withdrawn: m.administrationCustomerMarketingConsentWithdrawn,
  })[state]({}, { locale });
