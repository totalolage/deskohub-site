"use client";

import { useCallback, useEffect, useState } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import type { ConsentCategory } from "../config/consent-config";
import { getAcceptedConsentCategoriesFromCookie } from "../utils/consent-cookie";

export function useCookieConsent() {
  const [acceptedCategories, setAcceptedCategories] = useState<
    ConsentCategory[]
  >(() =>
    typeof document === "undefined"
      ? []
      : getAcceptedConsentCategoriesFromCookie(document.cookie)
  );

  useEffect(() => {
    const syncAcceptedCategories = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail?.acceptedCategories) {
        setAcceptedCategories(
          event.detail.acceptedCategories as ConsentCategory[]
        );
        return;
      }

      const preferences = CookieConsent.getUserPreferences();
      const preferenceCategories = (preferences?.acceptedCategories ||
        []) as ConsentCategory[];
      const acceptedCategories = preferenceCategories.length
        ? preferenceCategories
        : getAcceptedConsentCategoriesFromCookie(document.cookie);

      setAcceptedCategories(acceptedCategories);
    };

    syncAcceptedCategories();
    const syncAfterConsentProviderInit = window.setTimeout(
      syncAcceptedCategories,
      0
    );

    window.addEventListener("consentUpdated", syncAcceptedCategories);

    return () => {
      window.clearTimeout(syncAfterConsentProviderInit);
      window.removeEventListener("consentUpdated", syncAcceptedCategories);
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
