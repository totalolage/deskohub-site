"use client";

import { useEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import type { WorkspaceLocale } from "@/features/i18n";
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

type CookieConsentProviderProps = {
  locale: WorkspaceLocale;
};

export function CookieConsentProvider({ locale }: CookieConsentProviderProps) {
  useEffect(() => {
    initializeConsentMode();

    CookieConsent.run({
      ...createConsentConfig(locale),
      onFirstConsent: handleConsentChange,
      onConsent: handleConsentChange,
      onChange: handleConsentChange,
    });

    handleConsentChange();
  }, [locale]);

  return null;
}

function handleConsentChange() {
  const preferences = CookieConsent.getUserPreferences();
  const acceptedCategories = preferences?.acceptedCategories || [];

  if (CookieConsent.acceptedCategory("analytics")) {
    grantAnalyticsConsent();
  } else {
    denyAnalyticsConsent();
  }

  if (CookieConsent.acceptedCategory("marketing")) {
    grantMarketingConsent();
  } else {
    denyMarketingConsent();
  }

  if (CookieConsent.acceptedCategory("preferences")) {
    grantPreferencesConsent();
  } else {
    denyPreferencesConsent();
  }

  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("consentUpdated", {
      detail: { acceptedCategories },
    })
  );
}
