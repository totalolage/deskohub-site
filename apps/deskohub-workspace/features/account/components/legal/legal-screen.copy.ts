import type { Locale } from "@/features/i18n";
import type { LegalScreenStrings } from "./legal-screen";

// Proposed copy for callers and tests; LegalScreen always requires explicit strings.
export const legalScreenCopy = {
  "en-US": {
    title: "Legal, privacy & GDPR consents",
    analyticsTitle: "Web & usage analytics",
    analyticsDescription:
      "Analytics preferences cannot be viewed or changed from your account.",
    marketingTitle: "Marketing & community communications",
    marketingDescription:
      "Communications consent cannot be viewed or changed from your account.",
    preferencesUnavailable:
      "Account consent settings are not available here. Use cookie settings to manage this browser's cookies.",
    unavailable: "Unavailable",
    archiveTitle: "Your personal data archive",
    archiveDescription:
      "Requesting or downloading a personal data archive is not available in your account.",
    archiveAction: "Request GDPR data archive",
    savePreferences: "Save consent preferences",
  },
  "cs-CZ": {
    title: "Právní informace, soukromí a souhlasy GDPR",
    analyticsTitle: "Analytika webu a používání",
    analyticsDescription:
      "Nastavení analytiky nelze v účtu zobrazit ani změnit.",
    marketingTitle: "Marketingová a komunitní sdělení",
    marketingDescription:
      "Souhlas se zasíláním sdělení nelze v účtu zobrazit ani změnit.",
    preferencesUnavailable:
      "Nastavení souhlasů v účtu zde není dostupné. Soubory cookie tohoto prohlížeče můžete spravovat v nastavení cookies.",
    unavailable: "Nedostupné",
    archiveTitle: "Archiv vašich osobních údajů",
    archiveDescription:
      "Žádost o archiv osobních údajů ani jeho stažení nejsou v účtu dostupné.",
    archiveAction: "Požádat o archiv osobních údajů",
    savePreferences: "Uložit nastavení souhlasů",
  },
} satisfies Readonly<Record<Locale, LegalScreenStrings>>;
