export type ConsentStatus = "granted" | "denied";

export interface ConsentState {
  ad_storage: ConsentStatus;
  ad_user_data: ConsentStatus;
  ad_personalization: ConsentStatus;
  analytics_storage: ConsentStatus;
  functionality_storage: ConsentStatus;
  personalization_storage: ConsentStatus;
  security_storage: ConsentStatus;
}

export const DEFAULT_CONSENT_STATE: ConsentState = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  functionality_storage: "granted",
  personalization_storage: "denied",
  security_storage: "granted",
};

type GtmQueueWindow = Window & {
  dataLayer: unknown[];
  gtag: NonNullable<Window["gtag"]>;
};

function getGtmQueueWindow(): GtmQueueWindow | undefined {
  if (typeof window === "undefined") return undefined;

  window.dataLayer = window.dataLayer || [];

  if (typeof window.gtag === "function") return window as GtmQueueWindow;

  window.gtag = function gtag(...gtagArguments) {
    window.dataLayer?.push(gtagArguments);
  };

  return window as GtmQueueWindow;
}

export function initializeConsentMode(): void {
  const gtmQueueWindow = getGtmQueueWindow();
  if (!gtmQueueWindow) return;

  gtmQueueWindow.gtag("consent", "default", DEFAULT_CONSENT_STATE);
}

export function updateConsentMode(consent: Partial<ConsentState>): void {
  const gtmQueueWindow = getGtmQueueWindow();
  if (!gtmQueueWindow) return;

  gtmQueueWindow.gtag("consent", "update", consent);
}

export function pushConsentUpdateEvent(): void {
  if (typeof window === "undefined") return;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "consent_update" });
}

export function grantAnalyticsConsent(): void {
  updateConsentMode({ analytics_storage: "granted" });
}

export function denyAnalyticsConsent(): void {
  updateConsentMode({ analytics_storage: "denied" });
}

export function grantMarketingConsent(): void {
  updateConsentMode({
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
  });
}

export function denyMarketingConsent(): void {
  updateConsentMode({
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
}

export function grantPreferencesConsent(): void {
  updateConsentMode({ personalization_storage: "granted" });
}

export function denyPreferencesConsent(): void {
  updateConsentMode({ personalization_storage: "denied" });
}
