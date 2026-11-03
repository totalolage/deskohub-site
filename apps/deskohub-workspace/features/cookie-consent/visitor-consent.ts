"use client";

import { useSyncExternalStore } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import {
  signalOtherTabs,
  subscribeOtherTabSignal,
} from "@/shared/browser/local-storage";
import {
  type ConsentCategory,
  getAcceptedConsentCategoriesFromCookie,
} from "@/shared/utils/consent-cookie";

export type { ConsentCategory } from "@/shared/utils/consent-cookie";

/**
 * Where a consent change was noticed: announced in this tab, signalled by
 * another tab, or found when this tab regained focus.
 */
export type VisitorConsentChange = "local" | "other-tab" | "focus";

// The app event and the cross-tab key are part of the page's observable
// behavior; keep their names stable.
export const CONSENT_UPDATED_EVENT = "consentUpdated";
export const CONSENT_UPDATED_STORAGE_KEY = "deskohub.consent-updated";

type ConsentUpdatedEventDetail = {
  readonly _tag: "ConsentUpdated";
  readonly acceptedCategories: ConsentCategory[];
};

declare global {
  interface WindowEventMap {
    consentUpdated: CustomEvent<ConsentUpdatedEventDetail>;
  }
}

const acceptedCategories = (): ConsentCategory[] =>
  globalThis.document === undefined
    ? []
    : getAcceptedConsentCategoriesFromCookie(globalThis.document.cookie);

/**
 * The visitor's cookie consent. The consent cookie every tab writes is the
 * one source: a category counts as accepted only when every copy of the
 * cookie is well-formed and accepts it, the same rule the server applies.
 */
export const visitorConsent = {
  accepts: (category: ConsentCategory): boolean =>
    acceptedCategories().includes(category),

  /** Every accepted category, in display order. */
  acceptedCategories,

  /**
   * Calls `onChange` after consent may have changed. Read `accepts` again
   * there; the change says only where it was noticed.
   */
  subscribe: (
    onChange: (change: VisitorConsentChange) => void
  ): (() => void) => {
    if (globalThis.window === undefined) return () => undefined;

    const handleLocalChange = () => onChange("local");
    const handleFocus = () => onChange("focus");
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") handleFocus();
    };

    window.addEventListener(CONSENT_UPDATED_EVENT, handleLocalChange);
    const unsubscribeOtherTabs = subscribeOtherTabSignal(
      CONSENT_UPDATED_STORAGE_KEY,
      () => onChange("other-tab")
    );
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener(CONSENT_UPDATED_EVENT, handleLocalChange);
      unsubscribeOtherTabs();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  },

  // Toggles start from the shared consent cookie that every tab writes, not
  // from vanilla-cookieconsent's in-memory preferences, which never see other
  // tabs' changes.
  accept: (category: ConsentCategory): void => {
    saveAcceptedCategories([...acceptedCategories(), category]);
  },

  reject: (category: ConsentCategory): void => {
    if (category === "necessary") return;
    saveAcceptedCategories(
      acceptedCategories().filter((accepted) => accepted !== category)
    );
  },
};

type SavedConsentOptions = {
  /** True when the visitor gave first consent or changed it. */
  readonly announceToTagManager: boolean;
};

let applySavedConsent = (_options: SavedConsentOptions) =>
  announceVisitorConsentChange();

/**
 * Makes `apply` the step that follows every consent save in this tab, in
 * place of a bare announcement. The consent banner registers it.
 */
export function onVisitorConsentSaved(
  apply: (options: SavedConsentOptions) => void
): () => void {
  applySavedConsent = apply;
  return () => {
    if (applySavedConsent !== apply) return;
    applySavedConsent = () => announceVisitorConsentChange();
  };
}

const sameCategories = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((category) => right.includes(category));

function saveAcceptedCategories(categories: readonly ConsentCategory[]) {
  const saved = [...new Set<ConsentCategory>(["necessary", ...categories])];
  const remembered = CookieConsent.getUserPreferences().acceptedCategories;

  // vanilla-cookieconsent saves only when the set differs from the one it
  // remembers. After another tab changed the cookie, this tab may already
  // remember the requested set, and a withdrawal would silently not persist,
  // so the vendor rewrites its remembered set instead.
  if (
    sameCategories(remembered, saved) &&
    !sameCategories(acceptedCategories(), saved)
  ) {
    CookieConsent.setCookieData({
      value: CookieConsent.getCookie("data") ?? null,
      mode: "overwrite",
    });
    applySavedConsent({ announceToTagManager: true });
    return;
  }

  CookieConsent.acceptCategory(saved);
}

/**
 * Tells this tab's subscribers, then the browser's other tabs, that consent
 * may have changed. The consent banner calls it after the vendor saves
 * consent.
 */
export function announceVisitorConsentChange(): void {
  if (globalThis.window === undefined) return;

  window.dispatchEvent(
    new CustomEvent(CONSENT_UPDATED_EVENT, {
      detail: {
        _tag: "ConsentUpdated",
        acceptedCategories: acceptedCategories(),
      },
    })
  );
  signalOtherTabs(CONSENT_UPDATED_STORAGE_KEY);
}

/**
 * Whether the visitor accepts `category`, kept current across tabs. False on
 * the server and during hydration, so markup matches before the cookie is
 * read.
 */
export function useVisitorConsent(category: ConsentCategory): boolean {
  return useSyncExternalStore(
    visitorConsent.subscribe,
    () => visitorConsent.accepts(category),
    () => false
  );
}
