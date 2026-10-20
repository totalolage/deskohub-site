import type { AdministrationCustomerListInput } from "./administration.service";

/**
 * A customer's current marketing consent: an active grant, a withdrawn grant,
 * or no grant ever recorded.
 */
export const administrationCustomerMarketingConsentStates = [
  "granted",
  "withdrawn",
  "never",
] as const;

export type AdministrationCustomerMarketingConsentState =
  (typeof administrationCustomerMarketingConsentStates)[number];

export const parseAdministrationCustomerMarketingConsentState = (
  value: string | undefined
): AdministrationCustomerMarketingConsentState | undefined =>
  administrationCustomerMarketingConsentStates.find((state) => state === value);

/**
 * The customer list's filter and sort URL parameters, without the page. Sort
 * links, pagination, date shortcuts, and exports carry the same object, so
 * every view of the list keeps the operator's filters.
 */
export const getAdministrationCustomerListParams = (
  input: Omit<AdministrationCustomerListInput, "page">
): Readonly<Record<string, string | undefined>> => ({
  direction: input.direction,
  from: input.from,
  marketingConsent: input.marketingConsent,
  sort: input.sort,
  to: input.to,
});
