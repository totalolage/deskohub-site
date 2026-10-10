"use client";

import { useCallback, useEffect, useState } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import { getAcceptedConsentCategoriesFromCookie } from "@/shared/utils/consent-cookie";
import type { ConsentCategory } from "../config/consent-config";
import {
  CONSENT_UPDATED_EVENT,
  CONSENT_UPDATED_STORAGE_KEY,
} from "../utils/consent-event";

export function useCookieConsent() {
  // Initialize identically on the server and the client's first render so the
  // hydrate markup matches SSR even when a consent cookie exists; the
  // post-mount effect below syncs the authoritative cookie state afterwards.
  const [acceptedCategories, setAcceptedCategories] = useState<
    ConsentCategory[]
  >([]);

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
    const syncAcceptedCategoriesFromStorage = (event: StorageEvent) => {
      if (event.key !== CONSENT_UPDATED_STORAGE_KEY) return;

      setAcceptedCategories(
        getAcceptedConsentCategoriesFromCookie(document.cookie)
      );
    };

    syncAcceptedCategories();
    const syncAfterConsentProviderInit = window.setTimeout(
      syncAcceptedCategories,
      0
    );

    window.addEventListener(
      CONSENT_UPDATED_EVENT,
      syncAcceptedCategoriesFromEvent
    );
    window.addEventListener("storage", syncAcceptedCategoriesFromStorage);

    return () => {
      window.clearTimeout(syncAfterConsentProviderInit);
      window.removeEventListener(
        CONSENT_UPDATED_EVENT,
        syncAcceptedCategoriesFromEvent
      );
      window.removeEventListener("storage", syncAcceptedCategoriesFromStorage);
    };
  }, []);

  const acceptAll = () => {
    CookieConsent.acceptCategory("all");
  };

  const rejectAll = () => {
    CookieConsent.acceptCategory([]);
  };

  const showPreferences = () => {
    CookieConsent.showPreferences();
  };

  // vanilla-cookieconsent replaces the whole accepted set and its in-memory
  // preferences never see other tabs' changes, so toggles start from the
  // shared consent cookie that every tab writes.
  const acceptCategory = (category: ConsentCategory) => {
    const current = getAcceptedConsentCategoriesFromCookie(document.cookie);
    CookieConsent.acceptCategory([
      ...new Set(["necessary", ...current, category]),
    ]);
  };

  const rejectCategory = (category: ConsentCategory) => {
    if (category === "necessary") return;
    const current = getAcceptedConsentCategoriesFromCookie(document.cookie);
    CookieConsent.acceptCategory(current.filter((item) => item !== category));
  };

  // Consumers use this as an effect dependency, so keep its identity stable
  // even where the React Compiler does not run.
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
