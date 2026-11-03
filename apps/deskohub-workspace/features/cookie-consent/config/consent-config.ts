import type CookieConsent from "vanilla-cookieconsent";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { consentCategories } from "@/shared/utils/consent-cookie";

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
    // Only necessary cookies are on by default, and they cannot be declined.
    categories: Object.fromEntries(
      consentCategories.map((category) => [
        category,
        {
          enabled: category === "necessary",
          readOnly: category === "necessary",
        },
      ])
    ),
    language: {
      default: locale,
      translations: {
        [locale]: {
          consentModal: {
            title: m.cookieConsentConsentModalTitle({}, { locale }),
            description: m.cookieConsentConsentModalDescription({}, { locale }),
            acceptAllBtn: m.cookieConsentConsentModalAcceptAllBtn(
              {},
              { locale }
            ),
            acceptNecessaryBtn: m.cookieConsentConsentModalAcceptNecessaryBtn(
              {},
              { locale }
            ),
            showPreferencesBtn: m.cookieConsentConsentModalShowPreferencesBtn(
              {},
              { locale }
            ),
          },
          preferencesModal: {
            title: m.cookieConsentPreferencesModalTitle({}, { locale }),
            acceptAllBtn: m.cookieConsentPreferencesModalAcceptAllBtn(
              {},
              { locale }
            ),
            acceptNecessaryBtn:
              m.cookieConsentPreferencesModalAcceptNecessaryBtn({}, { locale }),
            savePreferencesBtn:
              m.cookieConsentPreferencesModalSavePreferencesBtn({}, { locale }),
            closeIconLabel: m.cookieConsentPreferencesModalCloseIconLabel(
              {},
              { locale }
            ),
            sections: [
              {
                title: m.cookieConsentPreferencesUsageTitle({}, { locale }),
                description: m.cookieConsentPreferencesUsageDescription(
                  {},
                  { locale }
                ),
              },
              {
                title: m.cookieConsentPreferencesNecessaryTitle({}, { locale }),
                description: m.cookieConsentPreferencesNecessaryDescription(
                  {},
                  { locale }
                ),
                linkedCategory: "necessary",
              },
              {
                title: m.cookieConsentPreferencesAnalyticsTitle({}, { locale }),
                description: m.cookieConsentPreferencesAnalyticsDescription(
                  {},
                  { locale }
                ),
                linkedCategory: "analytics",
              },
              {
                title: m.cookieConsentPreferencesMarketingTitle({}, { locale }),
                description: m.cookieConsentPreferencesMarketingDescription(
                  {},
                  { locale }
                ),
                linkedCategory: "marketing",
              },
              {
                title: m.cookieConsentPreferencesPersonalizationTitle(
                  {},
                  { locale }
                ),
                description:
                  m.cookieConsentPreferencesPersonalizationDescription(
                    {},
                    { locale }
                  ),
                linkedCategory: "preferences",
              },
            ],
          },
        },
      },
    },
  };
}
