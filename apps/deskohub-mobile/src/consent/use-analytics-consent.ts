import { useSyncExternalStore } from "react";
import {
  type AnalyticsConsent,
  type AnalyticsConsentStatus,
  createAnalyticsConsent,
} from "./analytics-consent";
import { consentStorage } from "./consent-storage";

let appConsent: AnalyticsConsent | undefined;

/** The app's one analytics consent answer, read from storage on first use. */
export const appAnalyticsConsent = (): AnalyticsConsent => {
  appConsent ??= createAnalyticsConsent(consentStorage, (message) =>
    console.warn(message)
  );
  return appConsent;
};

/** The analytics consent answer, and the actions that change it. */
export const useAnalyticsConsent = (): {
  readonly status: AnalyticsConsentStatus;
  readonly grant: () => void;
  readonly deny: () => void;
} => {
  const consent = appAnalyticsConsent();
  const status = useSyncExternalStore(
    consent.subscribe,
    consent.status,
    consent.status
  );
  return { status, grant: consent.grant, deny: consent.deny };
};
