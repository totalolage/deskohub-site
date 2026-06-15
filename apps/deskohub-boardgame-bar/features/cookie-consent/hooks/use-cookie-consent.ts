"use client";

import { useCallback, useEffect, useState } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import type { ConsentCategory } from "../config/consent-config";

interface UseCookieConsentReturn {
  acceptedCategories: ConsentCategory[];
  acceptAll: () => void;
  rejectAll: () => void;
  showPreferences: () => void;
  acceptCategory: (category: ConsentCategory) => void;
  rejectCategory: (category: ConsentCategory) => void;
  isAccepted: (category: ConsentCategory) => boolean;
}

/**
 * Hook for managing cookie consent
 */
export function useCookieConsent(): UseCookieConsentReturn {
  const [acceptedCategories, setAcceptedCategories] = useState<
    ConsentCategory[]
  >([]);

  // Update accepted categories when consent changes
  useEffect(() => {
    const updateAcceptedCategories = () => {
      const preferences = CookieConsent.getUserPreferences();
      const categories = (preferences?.acceptedCategories ||
        []) as ConsentCategory[];
      setAcceptedCategories(categories);
    };

    // Initial update
    updateAcceptedCategories();

    // Listen for consent changes
    const handleConsentUpdate = () => {
      updateAcceptedCategories();
    };

    window.addEventListener("consentUpdated", handleConsentUpdate);

    return () => {
      window.removeEventListener("consentUpdated", handleConsentUpdate);
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
    // Get current accepted categories
    const preferences = CookieConsent.getUserPreferences();
    const current = (preferences?.acceptedCategories ||
      []) as ConsentCategory[];
    const filtered = current.filter((c) => c !== category);
    CookieConsent.acceptCategory(filtered);
  }, []);

  const isAccepted = useCallback(
    (category: ConsentCategory) => {
      return acceptedCategories.includes(category);
    },
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
