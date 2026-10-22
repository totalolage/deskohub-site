import { Effect } from "effect";
import { aiAssistantsPageMarkdown } from "@/features/ai-assistants/ai-assistants-page-markdown";
import type { PublicOffering } from "@/features/checkout/public-offerings";
import { contactPageMarkdown } from "@/features/contact/contact-page-markdown";
import { coworkReservationPageMarkdown } from "@/features/cowork/cowork-reservation-page-markdown";
import { faqPageMarkdown } from "@/features/faq/faq-page-markdown";
import { type Locale, m } from "@/features/i18n";
import type { LandingPageSaleBannerContent } from "@/features/landing-page/components/landing-page-sale-banner";
import { landingPageMarkdown } from "@/features/landing-page/landing-page-markdown";
import {
  getLegalDocument,
  type LegalDocumentKey,
} from "@/features/legal/content";
import { legalPageMarkdown } from "@/features/legal/legal-page-markdown";
import { meetingRoomPageMarkdown } from "@/features/meeting-room/meeting-room-page-markdown";
import { meetingRoomReservationPageMarkdown } from "@/features/meeting-room/meeting-room-reservation-page-markdown";
import { officeReservationPageMarkdown } from "@/features/office/office-reservation-page-markdown";
import { pricingPageMarkdown } from "@/features/pricing/pricing-page-markdown";
import { teamPageMarkdown } from "@/features/team/team-page-markdown";
import { ttrpgRoomPageMarkdown } from "@/features/ttrpg-room/ttrpg-room-page-markdown";
import {
  type MarkdownBlocks,
  markdownHeading,
} from "@/shared/markdown/markdown";
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
  /** The page's title, as its metadata names it. */
  readonly title: (locale: Locale) => string;
  /** The facts the HTML page shows in `locale`, starting with its heading. */
  readonly render: (
    locale: Locale,
    sources: PublicPageMarkdownSources
  ) => Effect.Effect<MarkdownBlocks>;
}

const legalPage = (documentKey: LegalDocumentKey): PublicPageMarkdown => ({
  topic: "legal",
  title: (locale) => getLegalDocument(locale, documentKey).title,
  render: (locale) => Effect.succeed(legalPageMarkdown(locale, documentKey)),
});

const reservationPage = (
  title: PublicPageMarkdown["title"],
  renderOfferings: (
    locale: Locale,
    offerings: ReadonlyArray<PublicOffering>
  ) => MarkdownBlocks
): PublicPageMarkdown => ({
  topic: "booking",
  title,
  render: (locale, { offerings }) =>
    Effect.map(offerings, (loaded) => renderOfferings(locale, loaded)),
});

/**
 * The Markdown variant of every public page. Typecheck proves each page in
 * the registry has one, so a new public page must add its renderer here.
 */
export const publicPageMarkdown = {
  "/": {
    topic: "offer",
    title: (locale) => m.landingMetadataTitle({}, { locale }),
    render: landingPageMarkdown,
  },
  "/contact": {
    topic: "contact",
    title: (locale) => m.contactMetadataTitle({}, { locale }),
    render: contactPageMarkdown,
  },
  "/faq": {
    topic: "offer",
    title: (locale) => m.faqMetadataTitle({}, { locale }),
    render: faqPageMarkdown,
  },
  "/ai-assistants": {
    topic: "booking",
    title: (locale) => m.aiAssistantsMetadataTitle({}, { locale }),
    render: aiAssistantsPageMarkdown,
  },
  "/pricing": {
    topic: "prices",
    title: (locale) => m.pricingPageTitle({}, { locale }),
    render: pricingPageMarkdown,
  },
  "/meeting-room": {
    topic: "offer",
    title: (locale) => m.meetingRoomMetadataTitle({}, { locale }),
    render: meetingRoomPageMarkdown,
  },
  "/team": {
    topic: "offer",
    title: (locale) => m.teamMetadataTitle({}, { locale }),
    render: teamPageMarkdown,
  },
  "/ttrpg-room": {
    topic: "offer",
    title: (locale) => m.ttrpgRoomMetadataTitle({}, { locale }),
    render: ttrpgRoomPageMarkdown,
  },
  "/logo": {
    topic: "optional",
    title: (locale) => m.logoVariantsTitle({}, { locale }),
    render: (locale) =>
      Effect.succeed([markdownHeading(1, m.logoVariantsTitle({}, { locale }))]),
  },
  "/terms-and-conditions": legalPage("terms-and-conditions"),
  "/privacy-policy": legalPage("privacy-policy"),
  "/cookie-policy": legalPage("cookie-policy"),
  "/operating-rules": legalPage("operating-rules"),
  "/marketing-communications": legalPage("marketing-communications"),
  "/reservation/cowork": reservationPage(
    (locale) => m.checkoutOrderMetadataTitle({}, { locale }),
    coworkReservationPageMarkdown
  ),
  "/reservation/meeting-room": reservationPage(
    (locale) => m.reservationMeetingRoomMetadataTitle({}, { locale }),
    meetingRoomReservationPageMarkdown
  ),
  "/reservation/office": reservationPage(
    (locale) => m.reservationOfficeMetadataTitle({}, { locale }),
    officeReservationPageMarkdown
  ),
} satisfies Record<PublicPagePathname, PublicPageMarkdown>;
