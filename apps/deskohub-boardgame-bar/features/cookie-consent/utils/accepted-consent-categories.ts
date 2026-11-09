import type CookieConsent from "vanilla-cookieconsent";
import type { ConsentCategory } from "../config/consent-config";

/**
 * The categories the visitor accepted in the cookie banner, or none before
 * the banner has stored a choice.
 */
export const acceptedConsentCategories = (
  preferences:
    | Pick<CookieConsent.UserPreferences, "acceptedCategories">
    | undefined
): ConsentCategory[] =>
  (preferences?.acceptedCategories || []) as ConsentCategory[];
