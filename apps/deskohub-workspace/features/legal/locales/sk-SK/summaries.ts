import type {
  LegalDocumentKey,
  LegalDocumentSummary,
} from "../../legal-document-summaries";

export const legalDocumentSummaries = {
  "privacy-policy": {
    title: "Zásady ochrany osobných údajov",
    lead: "Na tejto stránke vysvetľujeme, ako Desktechub s.r.o. nakladá s osobnými údajmi na webe Deskohub Workspace vrátane zákazníckych účtov, kontaktného formulára a rezervácií.",
  },
  "marketing-communications": {
    title: "Súhlas s marketingovou komunikáciou",
    lead: "Toto oznámenie vysvetľuje nepovinný súhlas s budúcimi marketingovými a komunitnými správami Deskohub Workspace, ktoré vám e-mailom zasiela spoločnosť Desktechub s.r.o.",
  },
  "terms-and-conditions": {
    title: "Všeobecné obchodné podmienky",
    lead: "Tieto všeobecné obchodné podmienky upravujú coworkingové vstupy a online rezervácie zasadacej miestnosti a súkromnej kancelárie v Deskohub Workspace.",
  },
  "cookie-policy": {
    title: "Zásady používania cookies",
    lead: "Na tejto stránke vysvetľujeme, ako web Deskohub Workspace používa cookies a ako môžete spravovať svoje preferencie.",
  },
  "operating-rules": {
    title: "Prevádzkový poriadok",
    lead: "Tento prevádzkový poriadok upravuje správanie a užívanie coworkingových priestorov, zasadacej miestnosti, súkromnej kancelárie a eventových priestorov Deskohub Workspace.",
  },
} satisfies Record<LegalDocumentKey, LegalDocumentSummary>;
