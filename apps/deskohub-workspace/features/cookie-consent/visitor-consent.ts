"use client";

import { Option } from "effect";
import { useSyncExternalStore } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import {
  signalOtherTabs,
  subscribeOtherTabSignal,
} from "@/shared/browser/local-storage";
import {
  CONSENT_COOKIE_NAME,
  type ConsentCategory,
  getConsentCookieValuesFromCookie,
  readConsentCookieChoice,
} from "@/shared/utils/consent-cookie";

export type { ConsentCategory } from "@/shared/utils/consent-cookie";

/**
 * Where a consent change was noticed: announced in this tab after a save
 * there, announced in this tab after it applied a decision the signed-in
 * account made elsewhere (a silent grant, or a withdrawal from another
 * device), announced in this tab after the visitor changed the account's
 * analytics preference here, signalled by another tab, or found when this
 * tab regained focus.
 */
export type VisitorConsentChange =
  | "local"
  | "account"
  | "preference"
  | "other-tab"
  | "focus";

/** A change this tab announces itself. */
type AnnouncedVisitorConsentChange = Extract<
  VisitorConsentChange,
  "local" | "account" | "preference"
>;

// The app event and the cross-tab key are part of the page's observable
// behavior; keep their names stable.
export const CONSENT_UPDATED_EVENT = "consentUpdated";
export const CONSENT_UPDATED_STORAGE_KEY = "deskohub.consent-updated";

type ConsentUpdatedEventDetail = {
  readonly _tag: "ConsentUpdated";
  readonly acceptedCategories: ConsentCategory[];
  readonly change: AnnouncedVisitorConsentChange;
};

declare global {
  interface WindowEventMap {
    consentUpdated: CustomEvent<ConsentUpdatedEventDetail>;
  }
}

// The banner revision the page was served with; none until the banner binds
// it, and nothing counts as chosen until then.
let bannerRevision: number | undefined;

/**
 * Binds the banner revision the page was served with. The consent banner
 * binds it before any effect reads consent.
 */
export function bindVisitorConsentRevision(revision: number): void {
  bannerRevision = revision;
}

const savedChoice = () =>
  globalThis.document === undefined || bannerRevision === undefined
    ? Option.none()
    : readConsentCookieChoice(globalThis.document.cookie, {
        revision: bannerRevision,
      });

const acceptedCategories = (): ConsentCategory[] =>
  Option.match(savedChoice(), {
    onNone: () => [],
    onSome: (choice) => [...choice.acceptedCategories],
  });

// True while the vendor saves an account decision, whose announcement waits
// until the saved choice carries the decision's instant.
let savingAccountDecision = false;

/**
 * The visitor's cookie consent. The consent cookie every tab writes is the
 * one source: a category counts as accepted only when every copy of the
 * cookie is well-formed, saved under the banner revision the page was served
 * with, and accepts it, the same rule the server applies.
 */
export const visitorConsent = {
  /**
   * Whether the device holds a choice under the current banner revision. A
   * choice saved before the current privacy notice or cookie policy is none.
   */
  hasChoice: (): boolean => Option.isSome(savedChoice()),

  accepts: (category: ConsentCategory): boolean =>
    acceptedCategories().includes(category),

  /** Every accepted category, in display order. */
  acceptedCategories,

  /**
   * An opaque mark of the consent the device saved, empty without one. Every
   * save rewrites the cookie with a new last-consent timestamp, so the mark
   * changes with each save and stays put across page loads.
   */
  saveMark: (): string =>
    globalThis.document === undefined
      ? ""
      : getConsentCookieValuesFromCookie(globalThis.document.cookie).join("\n"),

  /**
   * Calls `onChange` after consent may have changed. Read `accepts` again
   * there; the change says only where it was noticed.
   */
  subscribe: (
    onChange: (change: VisitorConsentChange) => void
  ): (() => void) => {
    if (globalThis.window === undefined) return () => undefined;

    const handleLocalChange = (
      event: WindowEventMap[typeof CONSENT_UPDATED_EVENT]
    ) => onChange(event.detail.change);
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

  /**
   * Applies the signed-in account's analytics decision, made at `decidedAt`
   * (ISO 8601), to this device: saves analytics accepted or declined, keeping
   * the device's other categories as saved, or declining every other
   * optional category on a device without a choice, and dates the saved
   * choice at the decision, so a later mirror of the cookie never outranks a
   * decision made after it. It is announced once, as `change`, never as a
   * `local` save, so it is never recorded as a banner decision: `account`
   * for a decision made elsewhere (a silent grant, or a withdrawal from
   * another device), `preference` for one the visitor just made in this
   * tab's account preferences, which re-verifies the account before
   * identifying.
   */
  applyAccountDecision: ({
    analytics,
    decidedAt,
    change,
  }: {
    readonly analytics: boolean;
    readonly decidedAt: string;
    readonly change: Extract<VisitorConsentChange, "account" | "preference">;
  }): void => {
    const others = acceptedCategories().filter(
      (category) => category !== "analytics"
    );
    const categories: ConsentCategory[] = analytics
      ? [...others, "analytics"]
      : others;
    savingAccountDecision = true;
    try {
      if (CookieConsent.validConsent()) {
        saveAcceptedCategories(categories);
      } else {
        // The vendor's first save under this revision, which it always
        // persists; the banner may still be asking.
        CookieConsent.acceptCategory(categories);
        CookieConsent.hide();
      }
    } finally {
      savingAccountDecision = false;
    }
    dateSavedChoice(decidedAt);
    announce(change);
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
 * Rewrites the saved consent cookie with `lastConsentAt` as its last-consent
 * timestamp, keeping every other field and the attributes vanilla-cookieconsent
 * writes it with.
 */
function dateSavedChoice(lastConsentAt: string) {
  const saved = CookieConsent.getCookie();
  // The vendor resolves these with its defaults when it runs.
  const {
    name = CONSENT_COOKIE_NAME,
    path = "/",
    domain = location.hostname,
    sameSite = "Lax",
    secure = true,
  } = CookieConsent.getConfig("cookie") ?? {};
  const value = encodeURIComponent(
    JSON.stringify({ ...saved, lastConsentTimestamp: lastConsentAt })
  );
  const attributes = [
    `expires=${new Date(saved.expirationTime).toUTCString()}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
    ...(location.hostname.includes(".") ? [`Domain=${domain}`] : []),
    ...(secure && location.protocol === "https:" ? ["Secure"] : []),
  ];
  // biome-ignore lint/suspicious/noDocumentCookie: vanilla-cookieconsent has no API to date a saved choice, so the cookie is rewritten as it writes it.
  document.cookie = [`${name}=${value}`, ...attributes].join("; ");
}

/**
 * Tells this tab's subscribers, then the browser's other tabs, that consent
 * may have changed. The consent banner calls it after the vendor saves
 * consent.
 */
export function announceVisitorConsentChange(): void {
  if (savingAccountDecision) return;
  announce("local");
}

function announce(change: AnnouncedVisitorConsentChange) {
  if (globalThis.window === undefined) return;

  window.dispatchEvent(
    new CustomEvent(CONSENT_UPDATED_EVENT, {
      detail: {
        _tag: "ConsentUpdated",
        acceptedCategories: acceptedCategories(),
        change,
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
