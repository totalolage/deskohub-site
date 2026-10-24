import { type LocalizedCopy, m } from "@/features/i18n";
import {
  getLegalDocument,
  type LegalDocumentKey,
} from "@/features/legal/content";
import { type PublicPagePathname, publicPagePathnames } from "./public-pages";

// Route metadata, the Markdown variants and llms.txt read this registry, so
// it stays clear of page rendering, the Markdown renderers and server-only
// modules.


/** Release gate that decides whether production serves a gated page. */
export type PublicPageReleaseGate = "meeting-room-page" | "office-page";

export interface PublicPageDefinition {
  /** The page's own title: its metadata, Markdown heading and llms.txt link. */
  readonly title: LocalizedCopy;
  readonly description?: LocalizedCopy;
  /**
   * A legal document, whose browser title names the brand after the
   * document's own title and which shares as an article.
   */
  readonly document?: true;
  /**
   * Present when the page returns not found, in its metadata and its body,
   * while its gate is off. Discovery surfaces then leave it out.
   */
  readonly releaseGate?: PublicPageReleaseGate;
}

const legalPage = (documentKey: LegalDocumentKey): PublicPageDefinition => ({
  title: (_inputs, { locale }) => getLegalDocument(locale, documentKey).title,
  description: (_inputs, { locale }) =>
    getLegalDocument(locale, documentKey).lead,
  document: true,
});

/**
 * Every public page's title, description and release gate. Typecheck proves
 * each public page has one. A page here must not set `robots.index` to false.
 */
export const publicPageDefinitions: Readonly<
  Record<PublicPagePathname, PublicPageDefinition>
> = {
  "/": {
    title: m.landingMetadataTitle,
    description: m.landingMetadataDescription,
  },
  "/contact": {
    title: m.contactMetadataTitle,
    description: m.contactMetadataDescription,
  },
  "/faq": {
    title: m.faqMetadataTitle,
    description: m.faqMetadataDescription,
  },
  "/ai-assistants": {
    title: m.aiAssistantsMetadataTitle,
    description: m.aiAssistantsMetadataDescription,
  },
  "/pricing": {
    title: m.pricingPageTitle,
    description: m.pricingMetadataDescription,
  },
  "/meeting-room": {
    title: m.meetingRoomMetadataTitle,
    description: m.meetingRoomMetadataDescription,
    releaseGate: "meeting-room-page",
  },
  "/team": {
    title: m.teamMetadataTitle,
    description: m.teamMetadataDescription,
  },
  "/ttrpg-room": {
    title: m.ttrpgRoomMetadataTitle,
    description: m.ttrpgRoomMetadataDescription,
  },
  "/logo": { title: m.logoVariantsTitle },
  "/terms-and-conditions": legalPage("terms-and-conditions"),
  "/privacy-policy": legalPage("privacy-policy"),
  "/cookie-policy": legalPage("cookie-policy"),
  "/operating-rules": legalPage("operating-rules"),
  "/marketing-communications": legalPage("marketing-communications"),
  "/reservation/cowork": {
    title: m.checkoutOrderMetadataTitle,
    description: m.checkoutOrderMetadataDescription,
  },
  "/reservation/meeting-room": {
    title: m.reservationMeetingRoomMetadataTitle,
    description: m.reservationMeetingRoomMetadataDescription,
  },
  "/reservation/office": {
    title: m.reservationOfficeMetadataTitle,
    description: m.reservationOfficeMetadataDescription,
    releaseGate: "office-page",
  },
};

export interface PublicPage extends PublicPageDefinition {
  readonly pathname: PublicPagePathname;
}

/** Every public page with its definition, in registry order. */
export const publicPages: ReadonlyArray<PublicPage> = publicPagePathnames.map(
  (pathname) => ({ pathname, ...publicPageDefinitions[pathname] })
);
