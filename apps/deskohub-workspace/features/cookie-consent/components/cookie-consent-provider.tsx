"use client";

import { useEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import type { Locale } from "@/features/i18n";
import { isConsentCategory } from "@/shared/utils/consent-cookie";
import { createConsentConfig } from "../config/consent-config";
import { dispatchConsentUpdatedEvent } from "../utils/consent-event";
import {
  denyAnalyticsConsent,
  denyMarketingConsent,
  denyPreferencesConsent,
  grantAnalyticsConsent,
  grantMarketingConsent,
  grantPreferencesConsent,
  initializeConsentMode,
  pushConsentUpdateEvent,
} from "../utils/consent-mode";

type CookieConsentProviderProps = {
  locale: Locale;
};

export function CookieConsentProvider({ locale }: CookieConsentProviderProps) {
  useEffect(() => {
    initializeConsentMode();

    CookieConsent.run({
      ...createConsentConfig(locale),
      onFirstConsent: () =>
        handleConsentChange({ emitGtmConsentUpdateEvent: true }),
      onConsent: () =>
        handleConsentChange({ emitGtmConsentUpdateEvent: false }),
      onChange: () => handleConsentChange({ emitGtmConsentUpdateEvent: true }),
    });

    handleConsentChange({ emitGtmConsentUpdateEvent: false });
  }, [locale]);

  return null;
}

type HandleConsentChangeOptions = {
  emitGtmConsentUpdateEvent: boolean;
};

function handleConsentChange({
  emitGtmConsentUpdateEvent,
}: HandleConsentChangeOptions) {
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

  if (emitGtmConsentUpdateEvent) {
    queueMicrotask(pushConsentUpdateEvent);
  }

  const acceptedCategories = (
    CookieConsent.getUserPreferences().acceptedCategories || []
  ).filter(isConsentCategory);
  dispatchConsentUpdatedEvent(acceptedCategories);
}
