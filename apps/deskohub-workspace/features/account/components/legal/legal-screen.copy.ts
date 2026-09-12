import type { Locale } from "@/features/i18n";
import type { LegalScreenStrings } from "./legal-screen";

// Proposed copy for callers and tests; LegalScreen always requires explicit strings.
export const legalScreenCopy = {
  "en-US": {
    title: "Legal, privacy & GDPR consents",
    analyticsTitle: "Web & usage analytics",
    analyticsDescription:
      "Manage analytics and marketing cookies for this browser in cookie settings. These browser settings are separate from marketing communications consent.",
    marketingTitle: "Marketing & community communications",
    marketingDescription:
      "Manage marketing communications for the customer on the account privacy page when your verified account is linked to that customer record. A dedicated customer-specific link in a future marketing message can also let you opt in or withdraw. Contact support if neither option is available.",
    preferencesUnavailable:
      "Manage this browser's cookies in cookie settings. Manage marketing communications on the account privacy page when your verified account is linked to the customer record, through a dedicated customer-specific link in a future marketing message, or by contacting support.",
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
      "Analytické a marketingové cookies tohoto prohlížeče spravujte v nastavení cookies. Nastavení prohlížeče je oddělené od souhlasu s marketingovou komunikací.",
    marketingTitle: "Marketingová a komunitní sdělení",
    marketingDescription:
      "Marketingová sdělení pro zákazníka můžete spravovat na stránce ochrany osobních údajů v účtu, pokud je váš ověřený účet propojený s tímto záznamem zákazníka. Vyhrazený odkaz pro konkrétního zákazníka v budoucím marketingovém sdělení vám také může umožnit souhlas udělit nebo odvolat. Pokud žádná možnost není dostupná, kontaktujte podporu.",
    preferencesUnavailable:
      "Cookies tohoto prohlížeče spravujte v nastavení cookies. Marketingová sdělení spravujte na stránce ochrany osobních údajů v účtu, pokud je váš ověřený účet propojený se záznamem zákazníka, prostřednictvím vyhrazeného odkazu pro konkrétního zákazníka v budoucím marketingovém sdělení nebo kontaktováním podpory.",
    unavailable: "Nedostupné",
    archiveTitle: "Archiv vašich osobních údajů",
    archiveDescription:
      "Žádost o archiv osobních údajů ani jeho stažení nejsou v účtu dostupné.",
    archiveAction: "Požádat o archiv osobních údajů",
    savePreferences: "Uložit nastavení souhlasů",
  },
} satisfies Readonly<Record<Locale, LegalScreenStrings>>;
