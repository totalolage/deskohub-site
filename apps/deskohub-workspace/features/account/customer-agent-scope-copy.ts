import type { CustomerAgentConsentScope } from "@/features/account/customer-agent-routes";
import { type Locale, m } from "@/features/i18n";

/** What a granted scope lets an AI assistant do, in plain words. */
export const describeCustomerAgentScope = (
  scope: CustomerAgentConsentScope,
  locale: Locale
): string =>
  ({
    "offerings:read": m.customerAgentScopeOfferingsRead,
    "reservations:read": m.customerAgentScopeReservationsRead,
    "reservations:create": m.customerAgentScopeReservationsCreate,
    offline_access: m.customerAgentScopeOfflineAccess,
  })[scope]({}, { locale });
