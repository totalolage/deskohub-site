import type {
  LegalDocumentKey,
  LegalDocumentSummary,
} from "../../legal-document-summaries";

export const legalDocumentSummaries = {
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
} satisfies Record<LegalDocumentKey, LegalDocumentSummary>;
