/**
 * Cookie Consent Configuration
 * Based on vanilla-cookieconsent library
 */

import type * as CookieConsent from "vanilla-cookieconsent";

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
  locale: "cs" | "en"
): CookieConsent.CookieConsentConfig {
  const translations = getTranslations(locale);

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
        [locale]: translations,
      },
    },
  };
}

/**
 * Get translations for consent banner
 */
function getTranslations(locale: "cs" | "en"): CookieConsent.Translation {
  const translations: Record<"cs" | "en", CookieConsent.Translation> = {
    en: {
      consentModal: {
        title: "We use cookies",
        description:
          "We use cookies to improve your browsing experience, serve personalized content, and analyze our traffic. By clicking 'Accept all', you consent to our use of cookies.",
        acceptAllBtn: "Accept all",
        acceptNecessaryBtn: "Reject all",
        showPreferencesBtn: "Manage preferences",
      },
      preferencesModal: {
        title: "Cookie Preferences",
        acceptAllBtn: "Accept all",
        acceptNecessaryBtn: "Reject all",
        savePreferencesBtn: "Save preferences",
        closeIconLabel: "Close",
        sections: [
          {
            title: "Cookie Usage",
            description:
              "We use cookies to ensure the basic functionalities of the website and to enhance your online experience. You can choose for each category to opt-in/out whenever you want.",
          },
          {
            title: "Strictly Necessary Cookies",
            description:
              "These cookies are essential for the proper functioning of the website. Without these cookies, the website would not work properly.",
            linkedCategory: "necessary",
          },
          {
            title: "Analytics Cookies",
            description:
              "These cookies collect information about how you use our website, such as which pages you visited and which links you clicked on. All of the data is anonymized and cannot be used to identify you.",
            linkedCategory: "analytics",
          },
          {
            title: "Marketing Cookies",
            description:
              "These cookies are used to track visitors across websites. The intention is to display ads that are relevant and engaging for the individual user.",
            linkedCategory: "marketing",
          },
          {
            title: "Preference Cookies",
            description:
              "These cookies allow the website to remember choices you have made in the past, like what language you prefer, or what your user name and password are so you can automatically log in.",
            linkedCategory: "preferences",
          },
        ],
      },
    },
    cs: {
      consentModal: {
        title: "Používáme cookies",
        description:
          "Používáme cookies ke zlepšení vašeho prohlížení, poskytování personalizovaného obsahu a analýze návštěvnosti. Kliknutím na 'Přijmout vše' souhlasíte s použitím cookies.",
        acceptAllBtn: "Přijmout vše",
        acceptNecessaryBtn: "Odmítnout vše",
        showPreferencesBtn: "Spravovat předvolby",
      },
      preferencesModal: {
        title: "Nastavení cookies",
        acceptAllBtn: "Přijmout vše",
        acceptNecessaryBtn: "Odmítnout vše",
        savePreferencesBtn: "Uložit nastavení",
        closeIconLabel: "Zavřít",
        sections: [
          {
            title: "Používání cookies",
            description:
              "Používáme cookies k zajištění základních funkcí webu a ke zlepšení vašeho online zážitku. Pro každou kategorii si můžete zvolit, zda ji chcete povolit nebo zakázat.",
          },
          {
            title: "Nezbytné cookies",
            description:
              "Tyto cookies jsou nezbytné pro správné fungování webu. Bez těchto cookies by web nefungoval správně.",
            linkedCategory: "necessary",
          },
          {
            title: "Analytické cookies",
            description:
              "Tyto cookies sbírají informace o tom, jak používáte náš web, například které stránky jste navštívili a na které odkazy jste klikli. Všechna data jsou anonymizována a nelze je použít k vaší identifikaci.",
            linkedCategory: "analytics",
          },
          {
            title: "Marketingové cookies",
            description:
              "Tyto cookies se používají ke sledování návštěvníků napříč weby. Záměrem je zobrazovat reklamy, které jsou relevantní a zajímavé pro jednotlivé uživatele.",
            linkedCategory: "marketing",
          },
          {
            title: "Preferenční cookies",
            description:
              "Tyto cookies umožňují webu zapamatovat si volby, které jste v minulosti provedli, například jaký jazyk preferujete nebo jaké jsou vaše přihlašovací údaje, abyste se mohli automaticky přihlásit.",
            linkedCategory: "preferences",
          },
        ],
      },
    },
  };

  return translations[locale];
}
