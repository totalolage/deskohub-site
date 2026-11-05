/**
 * Google Consent Mode v2 Utilities
 * Manages consent state and updates for Google services
 */

import type CookieConsent from "vanilla-cookieconsent";
import type { ConsentCategory } from "../config/consent-config";
import { acceptedConsentCategories } from "./accepted-consent-categories";

export type ConsentStatus = "granted" | "denied";

export interface ConsentState {
  ad_storage: ConsentStatus;
  ad_user_data: ConsentStatus;
  ad_personalization: ConsentStatus;
  analytics_storage: ConsentStatus;
  functionality_storage: ConsentStatus;
  personalization_storage: ConsentStatus;
  security_storage: ConsentStatus;
}

/**
 * Default consent state - all denied except necessary cookies
 */
export const DEFAULT_CONSENT_STATE: ConsentState = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  functionality_storage: "granted", // Necessary for site functionality
  personalization_storage: "denied",
  security_storage: "granted", // Necessary for security
};

/**
 * Initialize Google Consent Mode with default denied state
 */
export function initializeConsentMode(): void {
  if (typeof window === "undefined") return;

  // Initialize dataLayer if it doesn't exist
  window.dataLayer = window.dataLayer || [];

  // Set default consent state
  window.gtag?.("consent", "default", DEFAULT_CONSENT_STATE);
}

/**
 * Update consent state based on user choices
 */
export function updateConsentMode(consent: Partial<ConsentState>): void {
  if (typeof window === "undefined") return;

  window.gtag?.("consent", "update", consent);
}

/**
 * Grant analytics consent
 */
export function grantAnalyticsConsent(): void {
  updateConsentMode({
    analytics_storage: "granted",
  });
}

/**
 * Grant marketing consent
 */
export function grantMarketingConsent(): void {
  updateConsentMode({
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
  });
}

/**
 * Grant preferences consent
 */
export function grantPreferencesConsent(): void {
  updateConsentMode({
    personalization_storage: "granted",
  });
}

/**
 * Deny analytics consent
 */
export function denyAnalyticsConsent(): void {
  updateConsentMode({
    analytics_storage: "denied",
  });
}

/**
 * Deny marketing consent
 */
export function denyMarketingConsent(): void {
  updateConsentMode({
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
}

/**
 * Deny preferences consent
 */
export function denyPreferencesConsent(): void {
  updateConsentMode({
    personalization_storage: "denied",
  });
}

const consentModeUpdates = {
  analytics: { grant: grantAnalyticsConsent, deny: denyAnalyticsConsent },
  marketing: { grant: grantMarketingConsent, deny: denyMarketingConsent },
  preferences: {
    grant: grantPreferencesConsent,
    deny: denyPreferencesConsent,
  },
} satisfies Partial<
  Record<ConsentCategory, { grant: () => void; deny: () => void }>
>;

/**
 * Window event announcing the visitor's accepted categories after every
 * consent sync, for GTM and `useCookieConsent`.
 */
export const CONSENT_UPDATED_EVENT = "consentUpdated";

/** The cookie banner's view of the visitor's current choices. */
export interface CookieConsentChoices {
  getUserPreferences(): Pick<
    CookieConsent.UserPreferences,
    "acceptedCategories"
  >;
  acceptedCategory(category: string): boolean;
}

/**
 * Mirrors the cookie banner's current choices into Google Consent Mode and
 * announces the accepted categories.
 */
export function syncConsentMode(cookieConsent: CookieConsentChoices): void {
  const acceptedCategories = acceptedConsentCategories(
    cookieConsent.getUserPreferences()
  );

  for (const [category, update] of Object.entries(consentModeUpdates)) {
    if (cookieConsent.acceptedCategory(category)) {
      update.grant();
    } else {
      update.deny();
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(CONSENT_UPDATED_EVENT, {
        detail: { acceptedCategories },
      })
    );
  }
}
