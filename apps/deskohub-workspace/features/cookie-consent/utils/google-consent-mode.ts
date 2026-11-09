import type { ConsentCategory } from "@/shared/utils/consent-cookie";
import { consentCategories } from "@/shared/utils/consent-cookie";

type ConsentStatus = "granted" | "denied";

export interface GoogleConsentState {
  ad_storage: ConsentStatus;
  ad_user_data: ConsentStatus;
  ad_personalization: ConsentStatus;
  analytics_storage: ConsentStatus;
  functionality_storage: ConsentStatus;
  personalization_storage: ConsentStatus;
  security_storage: ConsentStatus;
}

const DEFAULT_CONSENT_STATE: GoogleConsentState = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  functionality_storage: "granted",
  personalization_storage: "denied",
  security_storage: "granted",
};

// The Google consent signals each visitor consent category controls.
const consentSignalsByCategory = {
  necessary: [],
  analytics: ["analytics_storage"],
  marketing: ["ad_storage", "ad_user_data", "ad_personalization"],
  preferences: ["personalization_storage"],
} as const satisfies Record<
  ConsentCategory,
  readonly (keyof GoogleConsentState)[]
>;

type GtmQueueWindow = Window & {
  dataLayer: unknown[];
  gtag: NonNullable<Window["gtag"]>;
};

function getGtmQueueWindow(): GtmQueueWindow | undefined {
  if (globalThis.window === undefined) return undefined;

  window.dataLayer = window.dataLayer || [];

  if (window.gtag) return window as GtmQueueWindow;

  window.gtag = function gtag(...gtagArguments) {
    window.dataLayer?.push(gtagArguments);
  };

  return window as GtmQueueWindow;
}

/** Queues Google consent mode's denied-by-default state before any tag runs. */
export function setGoogleConsentDefaults(): void {
  getGtmQueueWindow()?.gtag("consent", "default", DEFAULT_CONSENT_STATE);
}

export type GoogleConsentUpdateOptions = {
  /**
   * Queues the `consent_update` dataLayer event after the caller's current
   * synchronous work, for first consent and changes only.
   */
  readonly announceToTagManager: boolean;
};

/**
 * Queues one Google consent mode update per optional category, granted when
 * `accepted` includes it and denied otherwise.
 */
export function updateGoogleConsentMode(
  accepted: readonly ConsentCategory[],
  { announceToTagManager }: GoogleConsentUpdateOptions
): void {
  const gtmQueueWindow = getGtmQueueWindow();
  if (!gtmQueueWindow) return;

  for (const category of consentCategories) {
    const signals = consentSignalsByCategory[category];
    if (signals.length === 0) continue;

    const status: ConsentStatus = accepted.includes(category)
      ? "granted"
      : "denied";
    gtmQueueWindow.gtag(
      "consent",
      "update",
      Object.fromEntries(signals.map((signal) => [signal, status]))
    );
  }

  if (announceToTagManager) {
    queueMicrotask(() => {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: "consent_update" });
    });
  }
}
