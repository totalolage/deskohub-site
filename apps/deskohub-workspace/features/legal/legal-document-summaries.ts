import type { Locale } from "@/features/i18n";

// Page metadata and llms.txt read a legal document's title and lead without
// its body, so this module holds plain strings and no rendering.

export type LegalDocumentKey =
  | "privacy-policy"
  | "marketing-communications"
  | "terms-and-conditions"
  | "cookie-policy"
  | "operating-rules";

export interface LegalDocumentSummary {
  readonly title: string;
  readonly lead: string;
}

const legalDocumentSummaries = {
  "en-US": {
    "privacy-policy": {
      title: "Privacy Policy",
      lead: "This page explains how Desktechub s.r.o. handles personal data on the Deskohub Workspace website, including customer accounts, contact forms, and reservations.",
    },
    "marketing-communications": {
      title: "Marketing Communications Consent",
      lead: "This notice explains the optional consent for future Deskohub Workspace marketing and community communications by email from Desktechub s.r.o.",
    },
    "terms-and-conditions": {
      title: "General Terms and Conditions",
      lead: "These General Terms and Conditions govern coworking entries and online meeting-room and private-office bookings at Deskohub Workspace.",
    },
    "cookie-policy": {
      title: "Cookie Policy",
      lead: "This page explains how the Deskohub Workspace website uses cookies and how you can manage your preferences.",
    },
    "operating-rules": {
      title: "House Rules",
      lead: "These House Rules govern conduct and the use of Deskohub Workspace coworking spaces, meeting room, private office, and event spaces.",
    },
  },
  "cs-CZ": {
    "privacy-policy": {
      title: "Zásady ochrany osobních údajů",
      lead: "Na této stránce vysvětlujeme, jak Desktechub s.r.o. nakládá s osobními údaji na webu Deskohub Workspace, včetně zákaznických účtů, kontaktního formuláře a rezervací.",
    },
    "marketing-communications": {
      title: "Souhlas s marketingovou komunikací",
      lead: "Toto oznámení vysvětluje nepovinný souhlas s budoucími marketingovými a komunitními sděleními Deskohub Workspace e-mailem od společnosti Desktechub s.r.o.",
    },
    "terms-and-conditions": {
      title: "Všeobecné obchodní podmínky",
      lead: "Tyto všeobecné obchodní podmínky upravují coworkingové vstupy a online rezervace zasedací místnosti a soukromé kanceláře v Deskohub Workspace.",
    },
    "cookie-policy": {
      title: "Zásady používání cookies",
      lead: "Na této stránce vysvětlujeme, jak web Deskohub Workspace používá cookies a jak můžete spravovat své preference.",
    },
    "operating-rules": {
      title: "Provozní řád",
      lead: "Tento provozní řád upravuje chování a užívání coworkingových prostor, zasedací místnosti, soukromé kanceláře a eventových prostor Deskohub Workspace.",
    },
  },
} satisfies Record<Locale, Record<LegalDocumentKey, LegalDocumentSummary>>;

export function getLegalDocumentSummary(
  locale: Locale,
  documentKey: LegalDocumentKey
): LegalDocumentSummary {
  return legalDocumentSummaries[locale][documentKey];
}
