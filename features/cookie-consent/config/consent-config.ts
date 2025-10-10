/**
 * Cookie Consent Configuration
 * Based on vanilla-cookieconsent library
 * Uses Paraglide for translations
 */

import type CookieConsent from "vanilla-cookieconsent";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";

export type ConsentCategory =
  | "necessary"
  | "analytics"
  | "marketing"
  | "preferences";

export interface ConsentConfig {
  categories: Record<
    ConsentCategory,
    {
      enabled: boolean;
      readOnly: boolean;
    }
  >;
}

/**
 * Create cookie consent configuration for vanilla-cookieconsent
 */
export function createConsentConfig(
  locale: Locale
): CookieConsent.CookieConsentConfig {
  return {
    guiOptions: {
      consentModal: {
        layout: "box wide",
        position: "bottom center",
        equalWeightButtons: true,
        flipButtons: false,
      },
      preferencesModal: {
        layout: "box",
        equalWeightButtons: true,
        flipButtons: false,
      },
    },

    categories: {
      necessary: {
        enabled: true,
        readOnly: true,
      },
      analytics: {
        enabled: false,
        readOnly: false,
      },
      marketing: {
        enabled: false,
        readOnly: false,
      },
      preferences: {
        enabled: false,
        readOnly: false,
      },
    },

    language: {
      default: locale,
      translations: {
        [locale]: {
          consentModal: {
            title: m["cookieConsent.consentModal.title"](),
            description: m["cookieConsent.consentModal.description"](),
            acceptAllBtn: m["cookieConsent.consentModal.acceptAllBtn"](),
            acceptNecessaryBtn:
              m["cookieConsent.consentModal.acceptNecessaryBtn"](),
            showPreferencesBtn:
              m["cookieConsent.consentModal.showPreferencesBtn"](),
          },
          preferencesModal: {
            title: m["cookieConsent.preferencesModal.title"](),
            acceptAllBtn: m["cookieConsent.preferencesModal.acceptAllBtn"](),
            acceptNecessaryBtn:
              m["cookieConsent.preferencesModal.acceptNecessaryBtn"](),
            savePreferencesBtn:
              m["cookieConsent.preferencesModal.savePreferencesBtn"](),
            closeIconLabel:
              m["cookieConsent.preferencesModal.closeIconLabel"](),
            sections: [
              {
                title:
                  m["cookieConsent.preferencesModal.sections.usage.title"](),
                description:
                  m[
                    "cookieConsent.preferencesModal.sections.usage.description"
                  ](),
              },
              {
                title:
                  m[
                    "cookieConsent.preferencesModal.sections.necessary.title"
                  ](),
                description:
                  m[
                    "cookieConsent.preferencesModal.sections.necessary.description"
                  ](),
                linkedCategory: "necessary",
              },
              {
                title:
                  m[
                    "cookieConsent.preferencesModal.sections.analytics.title"
                  ](),
                description:
                  m[
                    "cookieConsent.preferencesModal.sections.analytics.description"
                  ](),
                linkedCategory: "analytics",
              },
              {
                title:
                  m[
                    "cookieConsent.preferencesModal.sections.marketing.title"
                  ](),
                description:
                  m[
                    "cookieConsent.preferencesModal.sections.marketing.description"
                  ](),
                linkedCategory: "marketing",
              },
              {
                title:
                  m[
                    "cookieConsent.preferencesModal.sections.preferences.title"
                  ](),
                description:
                  m[
                    "cookieConsent.preferencesModal.sections.preferences.description"
                  ](),
                linkedCategory: "preferences",
              },
            ],
          },
        },
      },
    },
  };
}
