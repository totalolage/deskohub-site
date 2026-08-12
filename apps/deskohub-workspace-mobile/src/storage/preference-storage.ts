import type { Locale } from "@/src/domain/shop";
import type { DeviceStorage } from "./device-storage";

const LOCALE_KEY = "deskohub-workspace:locale:v1";
const ANALYTICS_KEY = "deskohub-workspace:analytics-consent:v1";

export type AnalyticsConsent = "allowed" | "denied";

export function createPreferenceStorage(storage: DeviceStorage) {
  return {
    async loadLocale(): Promise<Locale | null> {
      const value = await storage.getItem(LOCALE_KEY);
      return value === "cs" || value === "en" ? value : null;
    },
    saveLocale(locale: Locale) {
      return storage.setItem(LOCALE_KEY, locale);
    },
    async loadAnalyticsConsent(): Promise<AnalyticsConsent> {
      const value = await storage.getItem(ANALYTICS_KEY);
      return value === "allowed" ? "allowed" : "denied";
    },
    saveAnalyticsConsent(consent: AnalyticsConsent) {
      return storage.setItem(ANALYTICS_KEY, consent);
    },
  };
}
