"use client";

import { useEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import { createConsentConfig } from "../config/consent-config";
import {
  denyAnalyticsConsent,
  denyMarketingConsent,
  denyPreferencesConsent,
  grantAnalyticsConsent,
  grantMarketingConsent,
  grantPreferencesConsent,
  initializeConsentMode,
} from "../utils/consent-mode";

interface CookieConsentProviderProps {
  locale: "cs" | "en";
}

/**
 * Cookie Consent Provider Component
 * Initializes and manages cookie consent banner with Google Consent Mode v2
 */
export function CookieConsentProvider({ locale }: CookieConsentProviderProps) {
  useEffect(() => {
    // Initialize Google Consent Mode with default denied state
    initializeConsentMode();

    // Initialize cookie consent banner
    const config = createConsentConfig(locale);

    CookieConsent.run({
      ...config,
      onConsent: () => {
        handleConsentChange();
      },
      onChange: () => {
        handleConsentChange();
      },
    });

    // Handle initial consent state if already set
    handleConsentChange();

    return () => {
      // Cleanup is handled by vanilla-cookieconsent
    };
  }, [locale]);

  return null;
}

/**
 * Handle consent changes and update Google Consent Mode
 */
function handleConsentChange() {
  // Get user preferences to access accepted categories
  const preferences = CookieConsent.getUserPreferences();
  const acceptedCategories = preferences?.acceptedCategories || [];

  // Update analytics consent
  if (CookieConsent.acceptedCategory("analytics")) {
    grantAnalyticsConsent();
  } else {
    denyAnalyticsConsent();
  }

  // Update marketing consent
  if (CookieConsent.acceptedCategory("marketing")) {
    grantMarketingConsent();
  } else {
    denyMarketingConsent();
  }

  // Update preferences consent
  if (CookieConsent.acceptedCategory("preferences")) {
    grantPreferencesConsent();
  } else {
    denyPreferencesConsent();
  }

  // Dispatch custom event for GTM to listen to
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("consentUpdated", {
        detail: { acceptedCategories },
      })
    );
  }
}
