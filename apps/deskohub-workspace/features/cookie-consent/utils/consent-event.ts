import type { ConsentCategory } from "../config/consent-config";

export const CONSENT_UPDATED_EVENT = "consentUpdated";

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
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(CONSENT_UPDATED_EVENT, {
      detail: { _tag: "ConsentUpdated", acceptedCategories },
    })
  );
}
