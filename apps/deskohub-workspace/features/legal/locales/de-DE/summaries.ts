import type {
  LegalDocumentKey,
  LegalDocumentSummary,
} from "../../legal-document-summaries";

export const legalDocumentSummaries = {
  "privacy-policy": {
    title: "Datenschutzerklärung",
    lead: "Auf dieser Seite erklären wir, wie Desktechub s.r.o. mit personenbezogenen Daten auf der Website von Deskohub Workspace umgeht, einschließlich Kundenkonten, Kontaktformular und Reservierungen.",
  },
  "marketing-communications": {
    title: "Einwilligung in Marketingkommunikation",
    lead: "Dieser Hinweis erläutert die optionale Einwilligung in künftige Marketing- und Community-Nachrichten von Deskohub Workspace, die die Gesellschaft Desktechub s.r.o. per E-Mail versendet.",
  },
  "terms-and-conditions": {
    title: "Allgemeine Geschäftsbedingungen",
    lead: "Diese Allgemeinen Geschäftsbedingungen regeln den Coworking-Zutritt sowie Online-Reservierungen des Meetingraums und des Privatbüros bei Deskohub Workspace.",
  },
  "cookie-policy": {
    title: "Cookie-Richtlinie",
    lead: "Auf dieser Seite erklären wir, wie die Website von Deskohub Workspace Cookies verwendet und wie Sie Ihre Präferenzen verwalten können.",
  },
  "operating-rules": {
    title: "Hausordnung",
    lead: "Diese Hausordnung regelt das Verhalten und die Nutzung in den Coworking-Räumen, im Meetingraum, im Privatbüro und in den Veranstaltungsräumen von Deskohub Workspace.",
  },
} satisfies Record<LegalDocumentKey, LegalDocumentSummary>;
