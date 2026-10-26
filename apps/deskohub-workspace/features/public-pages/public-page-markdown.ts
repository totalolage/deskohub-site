import { Effect } from "effect";
import { aiAssistantsPageMarkdown } from "@/features/ai-assistants/ai-assistants-page-markdown";
import type { PublicOffering } from "@/features/checkout/public-offerings";
import { contactPageMarkdown } from "@/features/contact/contact-page-markdown";
import { coworkReservationPageMarkdown } from "@/features/cowork/cowork-reservation-page-markdown";
import { coworkingPageMarkdown } from "@/features/cowork/coworking-page-markdown";
import { faqPageMarkdown } from "@/features/faq/faq-page-markdown";
import { galleryPageMarkdown } from "@/features/gallery/gallery-page-markdown";
import type { Locale } from "@/features/i18n";
import type { LandingPageSaleBannerContent } from "@/features/landing-page/components/landing-page-sale-banner";
import { landingPageMarkdown } from "@/features/landing-page/landing-page-markdown";
import type { LegalDocumentKey } from "@/features/legal/legal-document-summaries";
import { legalPageMarkdown } from "@/features/legal/legal-page-markdown";
import { meetingRoomPageMarkdown } from "@/features/meeting-room/meeting-room-page-markdown";
import { meetingRoomReservationPageMarkdown } from "@/features/meeting-room/meeting-room-reservation-page-markdown";
import { officeReservationPageMarkdown } from "@/features/office/office-reservation-page-markdown";
import { pricingPageMarkdown } from "@/features/pricing/pricing-page-markdown";
import { teamPageMarkdown } from "@/features/team/team-page-markdown";
import { ttrpgRoomPageMarkdown } from "@/features/ttrpg-room/ttrpg-room-page-markdown";
import type { MarkdownBlocks } from "@/shared/markdown/markdown";
import type { PublicPagePathname } from "./public-pages";

/** What a page is about, which groups it in `llms.txt`. */
export type PublicPageTopic =
  | "offer"
  | "booking"
  | "prices"
  | "contact"
  | "legal"
  | "optional";

/** Data a page's Markdown reads beyond its copy, loaded only when read. */
export interface PublicPageMarkdownSources {
  /**
   * Whether production serves a public page now. Content that only shows
   * while a gated page is released, such as a link to it, checks its page.
   */
  readonly isPublished: (pathname: PublicPagePathname) => boolean;
  /** Every bookable product with its advertised price, in catalog order. */
  readonly offerings: Effect.Effect<ReadonlyArray<PublicOffering>>;
  /** The home page's sale banner while a sale runs. */
  readonly saleBanner: Effect.Effect<LandingPageSaleBannerContent | undefined>;
}

export interface PublicPageMarkdown {
  readonly topic: PublicPageTopic;
  /** The facts the HTML page shows in `locale`, starting with its heading. */
  readonly render: (
    locale: Locale,
    sources: PublicPageMarkdownSources
  ) => Effect.Effect<MarkdownBlocks>;
}

const legalPage = (documentKey: LegalDocumentKey): PublicPageMarkdown => ({
  topic: "legal",
  render: (locale) => Effect.succeed(legalPageMarkdown(locale, documentKey)),
});

const reservationPage = (
  renderOfferings: (
    locale: Locale,
    offerings: ReadonlyArray<PublicOffering>
  ) => MarkdownBlocks
): PublicPageMarkdown => ({
  topic: "booking",
  render: (locale, { offerings }) =>
    Effect.map(offerings, (loaded) => renderOfferings(locale, loaded)),
});

/**
 * The Markdown variant of every public page, starting with the heading its
 * HTML page shows. llms.txt names the page by its definition's title instead.
 * Typecheck proves each public page has one, so a new public page must add
 * its renderer here.
 */
export const publicPageMarkdown = {
  "/": { topic: "offer", render: landingPageMarkdown },
  "/coworking": {
    topic: "offer",
    render: (locale, { offerings }) =>
      Effect.map(offerings, (loaded) => coworkingPageMarkdown(locale, loaded)),
  },
  "/contact": { topic: "contact", render: contactPageMarkdown },
  "/faq": { topic: "offer", render: faqPageMarkdown },
  "/ai-assistants": { topic: "booking", render: aiAssistantsPageMarkdown },
  "/pricing": { topic: "prices", render: pricingPageMarkdown },
  "/meeting-room": { topic: "offer", render: meetingRoomPageMarkdown },
  "/team": { topic: "offer", render: teamPageMarkdown },
  "/gallery": { topic: "offer", render: galleryPageMarkdown },
  "/ttrpg-room": { topic: "offer", render: ttrpgRoomPageMarkdown },
  "/terms-and-conditions": legalPage("terms-and-conditions"),
  "/privacy-policy": legalPage("privacy-policy"),
  "/cookie-policy": legalPage("cookie-policy"),
  "/operating-rules": legalPage("operating-rules"),
  "/marketing-communications": legalPage("marketing-communications"),
  "/reservation/cowork": reservationPage(coworkReservationPageMarkdown),
  "/reservation/meeting-room": reservationPage(
    meetingRoomReservationPageMarkdown
  ),
  "/reservation/office": reservationPage(officeReservationPageMarkdown),
} satisfies Record<PublicPagePathname, PublicPageMarkdown>;
