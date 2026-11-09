/**
 * A customer's current marketing consent: none recorded, granted and in force,
 * or withdrawn. A withdrawal recorded without a grant also reads as withdrawn.
 */
export type MarketingConsentStatus = "absent" | "active" | "withdrawn";
