"use client";

import { useEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import type { Locale } from "@/features/i18n";
import { createConsentConfig } from "../config/consent-config";
import { initializeConsentMode, syncConsentMode } from "../utils/consent-mode";

interface CookieConsentProviderProps {
  locale: Locale;
}

/**
 * Cookie Consent Provider Component
 * Initializes and manages cookie consent banner with Google Consent Mode v2
 */
export function CookieConsentProvider({ locale }: CookieConsentProviderProps) {
  useEffect(() => {
    // Initialize Google Consent Mode with default denied state
    initializeConsentMode();

    const config = createConsentConfig(locale);

    // Initialize cookie consent banner
    CookieConsent.run({
      ...config,
      onFirstConsent: handleConsentChange,
      onConsent: handleConsentChange,
      onChange: handleConsentChange,
    });

    // Handle initial consent state if already set
    handleConsentChange();
  }, [locale]);

  return null;
}

/**
 * Handle consent changes and update Google Consent Mode
 */
function handleConsentChange() {
  syncConsentMode(CookieConsent);
}
