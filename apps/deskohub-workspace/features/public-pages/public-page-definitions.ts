import { type LocalizedCopy, m } from "@/features/i18n";
import {
  getLegalDocumentSummary,
  type LegalDocumentKey,
} from "@/features/legal/legal-document-summaries";
import { type PublicPagePathname, publicPagePathnames } from "./public-pages";

// Route metadata, the Markdown variants and llms.txt read this registry, so
// it stays clear of page rendering, the Markdown renderers and server-only
// modules.

/** Release gate that decides whether production serves a gated page. */
export type PublicPageReleaseGate = "meeting-room-page" | "office-page";

export interface PublicPageDefinition {
  /**
   * The page's own title, without the site name that the document title
   * appends: its metadata, its llms.txt link, and a reservation page's h1 and
   * Markdown heading. Other pages keep their content heading.
   */
  readonly title: LocalizedCopy;
  readonly description?: LocalizedCopy;
  /**
   * The ISO day the page's content last changed, which the sitemap publishes
   * as `lastmod`. Search engines trust `lastmod` only while it tracks real
   * changes, so move it in the change that alters what the page shows, and
   * never to a deploy or build time. A legal page's date is its document's
   * "last updated" date.
   */
  readonly contentDate: string;
  /** Shares the page as an article rather than a website. */
  readonly article?: true;
  /**
   * Present when the page returns not found, in its metadata and its body,
   * while its gate is off. Discovery surfaces then leave it out.
   */
  readonly releaseGate?: PublicPageReleaseGate;
}

const legalPage = (
  documentKey: LegalDocumentKey,
  contentDate: string
): PublicPageDefinition => ({
  title: (_inputs, { locale }) =>
    getLegalDocumentSummary(locale, documentKey).title,
  description: (_inputs, { locale }) =>
    getLegalDocumentSummary(locale, documentKey).lead,
  contentDate,
  article: true,
});

/**
 * Every public page's title, description, content date and release gate. Typecheck proves
 * each public page has one. A page here must not set `robots.index` to false.
 */
export const publicPageDefinitions: Readonly<
  Record<PublicPagePathname, PublicPageDefinition>
> = {
  "/": {
    title: m.landingMetadataTitle,
    description: m.landingMetadataDescription,
    contentDate: "2026-10-25",
  },
  "/coworking": {
    title: m.coworkingMetadataTitle,
    description: m.coworkingMetadataDescription,
    contentDate: "2026-10-25",
  },
  "/contact": {
    title: m.contactMetadataTitle,
    description: m.contactMetadataDescription,
    contentDate: "2026-10-25",
  },
  "/faq": {
    title: m.faqMetadataTitle,
    description: m.faqMetadataDescription,
    contentDate: "2026-10-26",
  },
  "/ai-assistants": {
    title: m.aiAssistantsMetadataTitle,
    description: m.aiAssistantsMetadataDescription,
    contentDate: "2026-10-22",
  },
  "/pricing": {
    title: m.pricingMetadataTitle,
    description: m.pricingMetadataDescription,
    contentDate: "2026-10-19",
  },
  "/meeting-room": {
    title: m.meetingRoomMetadataTitle,
    description: m.meetingRoomMetadataDescription,
    contentDate: "2026-10-26",
    releaseGate: "meeting-room-page",
  },
  "/team": {
    title: m.teamMetadataTitle,
    description: m.teamMetadataDescription,
    contentDate: "2026-10-25",
  },
  "/gallery": {
    title: m.galleryMetadataTitle,
    description: m.galleryMetadataDescription,
    contentDate: "2026-10-25",
  },
  "/ttrpg-room": {
    title: m.ttrpgRoomMetadataTitle,
    description: m.ttrpgRoomMetadataDescription,
    contentDate: "2026-10-25",
  },
  "/terms-and-conditions": legalPage("terms-and-conditions", "2026-08-12"),
  "/privacy-policy": legalPage("privacy-policy", "2026-10-21"),
  "/cookie-policy": legalPage("cookie-policy", "2026-10-13"),
  "/operating-rules": legalPage("operating-rules", "2026-08-12"),
  "/marketing-communications": legalPage(
    "marketing-communications",
    "2026-08-05"
  ),
  "/reservation/cowork": {
    title: m.reservationCoworkMetadataTitle,
    description: m.reservationCoworkMetadataDescription,
    contentDate: "2026-10-25",
  },
  "/reservation/meeting-room": {
    title: m.reservationMeetingRoomMetadataTitle,
    description: m.reservationMeetingRoomMetadataDescription,
    contentDate: "2026-10-25",
  },
  "/reservation/office": {
    title: m.reservationOfficeMetadataTitle,
    description: m.reservationOfficeMetadataDescription,
    contentDate: "2026-10-25",
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
