import type { ConsentCategory } from "../config/consent-config";

export const CONSENT_UPDATED_EVENT = "consentUpdated";
export const CONSENT_UPDATED_STORAGE_KEY = "deskohub.consent-updated";

type ConsentUpdatedEventDetail = {
  readonly _tag: "ConsentUpdated";
  readonly acceptedCategories: ConsentCategory[];
};

export type ConsentUpdatedEvent = CustomEvent<ConsentUpdatedEventDetail>;

declare global {
  interface WindowEventMap {
    consentUpdated: ConsentUpdatedEvent;
  }
}

export function dispatchConsentUpdatedEvent(
  acceptedCategories: ConsentCategory[]
) {
  if (globalThis.window === undefined) return;

  window.dispatchEvent(
    new CustomEvent(CONSENT_UPDATED_EVENT, {
      detail: { _tag: "ConsentUpdated", acceptedCategories },
    })
  );

  try {
    window.localStorage.setItem(
      CONSENT_UPDATED_STORAGE_KEY,
      crypto.randomUUID()
    );
  } catch {
    // Storage is an optimization for other tabs, not the local state path.
  }
}
