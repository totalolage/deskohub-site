import { Context } from "effect";
import { useSyncExternalStore } from "react";
import { readLaunchLocale } from "../i18n/launch-locale";
import {
  type AnalyticsConsent,
  type AnalyticsConsentStatus,
  createAnalyticsConsent,
} from "./analytics-consent";
import { consentStorage } from "./consent-storage";

let appConsent: AnalyticsConsent | undefined;

/** The app's one analytics consent answer, read from storage on first use. */
export const appAnalyticsConsent = (): AnalyticsConsent => {
  appConsent ??= createAnalyticsConsent(
    consentStorage,
    (message) => console.warn(message),
    { now: () => new Date(), locale: readLaunchLocale }
  );
  return appConsent;
};

/**
 * This device's analytics consent, for Effects that read or change it on
 * the account's behalf. A Reference to the app's one answer, so every runtime
 * shares it without wiring; tests provide their own.
 */
export const DeviceAnalyticsConsent = Context.Reference<AnalyticsConsent>(
  "deskohub-mobile/DeviceAnalyticsConsent",
  { defaultValue: appAnalyticsConsent }
);

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
