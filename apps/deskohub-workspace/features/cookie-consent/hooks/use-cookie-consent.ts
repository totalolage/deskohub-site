"use client";

import { useCallback, useEffect, useState } from "react";
import CookieConsent from "vanilla-cookieconsent";
import type { ConsentCategory } from "../config/consent-config";

export function useCookieConsent() {
  const [acceptedCategories, setAcceptedCategories] = useState<
    ConsentCategory[]
  >([]);

  useEffect(() => {
    const syncAcceptedCategories = () => {
      const preferences = CookieConsent.getUserPreferences();
      setAcceptedCategories(
        (preferences?.acceptedCategories || []) as ConsentCategory[]
      );
    };

    syncAcceptedCategories();

    window.addEventListener("consentUpdated", syncAcceptedCategories);

    return () => {
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
