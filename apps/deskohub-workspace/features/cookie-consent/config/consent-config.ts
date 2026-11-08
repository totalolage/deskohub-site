import type CookieConsent from "vanilla-cookieconsent";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { getLegalDocumentPath } from "@/features/legal/legal-document-path";
import { consentCategories } from "@/shared/utils/consent-cookie";

/** Links to the privacy notice and the cookie policy the choice is made under. */
function legalDocumentLinks(locale: Locale): string {
  return [
    [
      getLegalDocumentPath(locale, "privacy-policy"),
      m.cookieConsentPrivacyPolicyLink({}, { locale }),
    ],
    [
      getLegalDocumentPath(locale, "cookie-policy"),
      m.cookieConsentCookiePolicyLink({}, { locale }),
    ],
  ]
    .map(([href, label]) => `<a href="${href}">${label}</a>`)
    .join("\n");
}

/**
 * The banner's configuration. `revision` binds saved choices to the current
 * legal documents. The banner never opens itself: the caller shows it once it
 * knows the device needs to choose.
 */
export function createConsentConfig(
  locale: Locale,
  revision: number
): CookieConsent.CookieConsentConfig {
  const links = legalDocumentLinks(locale);
  return {
    revision,
    autoShow: false,
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
            footer: links,
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
              // The vendor spaces a link group only in the consent modal's
              // footer, which wraps the footer in one itself.
              { description: `<span class="cm__link-group">${links}</span>` },
            ],
          },
        },
      },
    },
  };
}
