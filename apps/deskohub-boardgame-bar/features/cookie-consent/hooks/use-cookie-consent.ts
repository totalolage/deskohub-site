"use client";

import { useCallback, useEffect, useState } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import type { ConsentCategory } from "../config/consent-config";
import { acceptedConsentCategories } from "../utils/accepted-consent-categories";
import { CONSENT_UPDATED_EVENT } from "../utils/consent-mode";

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
      setAcceptedCategories(
        acceptedConsentCategories(CookieConsent.getUserPreferences())
      );
    };

    // Initial update
    updateAcceptedCategories();

    // Listen for consent changes
    const handleConsentUpdate = () => {
      updateAcceptedCategories();
    };

    window.addEventListener(CONSENT_UPDATED_EVENT, handleConsentUpdate);

    return () => {
      window.removeEventListener(CONSENT_UPDATED_EVENT, handleConsentUpdate);
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
    const current = acceptedConsentCategories(
      CookieConsent.getUserPreferences()
    );
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
