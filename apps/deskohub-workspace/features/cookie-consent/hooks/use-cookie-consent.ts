"use client";

import { useCallback, useEffect, useState } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import { getAcceptedConsentCategoriesFromCookie } from "@/shared/utils/consent-cookie";
import type { ConsentCategory } from "../config/consent-config";
import { CONSENT_UPDATED_EVENT } from "../utils/consent-event";

export function useCookieConsent() {
  const [acceptedCategories, setAcceptedCategories] = useState<
    ConsentCategory[]
  >(() =>
    typeof document === "undefined"
      ? []
      : getAcceptedConsentCategoriesFromCookie(document.cookie)
  );

  useEffect(() => {
    const syncAcceptedCategories = () => {
      const preferences = CookieConsent.getUserPreferences();
      const preferenceCategories = (preferences?.acceptedCategories ||
        []) as ConsentCategory[];
      const acceptedCategories = preferenceCategories.length
        ? preferenceCategories
        : getAcceptedConsentCategoriesFromCookie(document.cookie);

      setAcceptedCategories(acceptedCategories);
    };
    const syncAcceptedCategoriesFromEvent = (
      event: WindowEventMap[typeof CONSENT_UPDATED_EVENT]
    ) => setAcceptedCategories(event.detail.acceptedCategories);

    syncAcceptedCategories();
    const syncAfterConsentProviderInit = window.setTimeout(
      syncAcceptedCategories,
      0
    );

    window.addEventListener(
      CONSENT_UPDATED_EVENT,
      syncAcceptedCategoriesFromEvent
    );

    return () => {
      window.clearTimeout(syncAfterConsentProviderInit);
      window.removeEventListener(
        CONSENT_UPDATED_EVENT,
        syncAcceptedCategoriesFromEvent
      );
    };
  }, []);

  const acceptAll = useCallback(() => {
    CookieConsent.acceptCategory("all");
  }, []);

  const rejectAll = useCallback(() => {
    CookieConsent.acceptCategory([]);
  }, []);

  const showPreferences = useCallback(() => {
    CookieConsent.showPreferences();
  }, []);

  const acceptCategory = useCallback((category: ConsentCategory) => {
    CookieConsent.acceptCategory(category);
  }, []);

  const rejectCategory = useCallback((category: ConsentCategory) => {
    const preferences = CookieConsent.getUserPreferences();
    const current = (preferences?.acceptedCategories ||
      []) as ConsentCategory[];
    CookieConsent.acceptCategory(current.filter((item) => item !== category));
  }, []);

  const isAccepted = useCallback(
    (category: ConsentCategory) => acceptedCategories.includes(category),
    [acceptedCategories]
  );

  return {
    acceptedCategories,
    acceptAll,
    rejectAll,
    showPreferences,
    acceptCategory,
    rejectCategory,
    isAccepted,
  };
}
