import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { workspaceProductFamilies } from "@/features/discounts/product-target";
import { locales, m } from "@/features/i18n";
import type { PublicPageMarkdownSources } from "@/features/public-pages/public-page-markdown";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
} from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
} from "@/shared/utils/workspace-location-map";
import type { LandingPageSaleBannerContent } from "./components/landing-page-sale-banner";
import { landingPageMarkdown } from "./landing-page-markdown";
import { getLandingPageSaleBannerContent } from "./landing-page-sale-banner-content";

const sources = (
  meetingRoomPublished: boolean,
  saleBanner?: LandingPageSaleBannerContent
): PublicPageMarkdownSources => ({
  isPublished: (pathname) =>
    pathname !== "/meeting-room" || meetingRoomPublished,
  offerings: Effect.succeed([]),
  saleBanner: Effect.succeed(saleBanner),
});

const renderLandingPage = async (
  locale: (typeof locales)[number],
  meetingRoomPublished: boolean,
  saleBanner?: LandingPageSaleBannerContent
) =>
  serializeMarkdown(
    await Effect.runPromise(
      landingPageMarkdown(locale, sources(meetingRoomPublished, saleBanner))
    )
  );

/** The banner the HTML page shows for a 20% sale on every cowork product. */
const coworkSaleBanner = (locale: (typeof locales)[number]) =>
  getLandingPageSaleBannerContent({
    bookableProducts: workspaceProductFamilies,
    locale,
    reservationKind: "cowork",
    sale: {
      title: "*Summer* sale",
      adjustment: { kind: "percentage", basisPoints: 2000 },
      products: [{ kind: "cowork" }],
    },
  });

/**
 * The banner's sentence as the HTML page fills its template, with whitespace
 * collapsed as `markdownPlainText` collapses it.
 */
const bannerSentence = ({ label }: LandingPageSaleBannerContent) =>
  label.template
    .replace("{title}", label.title)
    .replace("{adjustment}", label.adjustment)
    .replace(/<\/?discount>/g, "")
    .replace(/\s+/g, " ");

// Left out on purpose: the metadata title and description, which the page
// sends as metadata; the hero image, carousel and map labels and alt text
// (landingHeroImageAlt, landingCarousel*, landingLocationMapAlt); and the
// decorative contact badge (landingNavContactLabel).
describe.each(locales)("landingPageMarkdown in %s", (locale) => {
  const infoEmail = workspaceSiteConstants.contact.infoEmail;
  const origin = "https://workspace.deskohub.cz";

  test("shows the hero, location and contact facts in page order", async () => {
    const markdown = await renderLandingPage(locale, true);

    expect(markdownPlainText(markdown)).toBe(
      [
        m.landingHeroTitle({}, { locale }),
        m.landingHeroSubtitle({}, { locale }),
        m.landingHeroMeetingRoomCta({}, { locale }),
        m.landingHeroPrimaryCta({}, { locale }),
        m.landingHeroSecondaryCta({}, { locale }),
        m.landingLocationMapTitle({}, { locale }),
        workspaceFormattedAddress,
        m.landingLocationMapCta({}, { locale }),
        m.landingFooterContactTitle({}, { locale }),
        m.landingFooterContactLead({}, { locale }),
        infoEmail,
        m.landingFooterContactCta({}, { locale }),
        m.landingFooterBarCta({}, { locale }),
      ].join("\n")
    );
    expect(markdown).toStartWith(`# ${m.landingHeroTitle({}, { locale })}`);
  });

  test("links each call to action to its absolute, locale-agnostic target", async () => {
    const markdown = await renderLandingPage(locale, true);

    expect(markdownLinkUrls(markdown)).toEqual([
      `${origin}/meeting-room`,
      `${origin}/reservation/cowork`,
      `${origin}/contact`,
      workspaceGoogleDirectionsUrl,
      `mailto:${infoEmail}`,
      `${origin}/contact`,
      `${origin}/#overview`,
    ]);
  });

  test("shows an active sale's banner under the hero heading, as the HTML page does", async () => {
    const banner = coworkSaleBanner(locale);
    const markdown = await renderLandingPage(locale, true, banner);

    expect(banner.label.template).toBe(
      m.landingSaleBannerAllCoworkProducts(
        { title: "{title}", adjustment: "{adjustment}" },
        { locale }
      )
    );
    expect(markdownPlainText(markdown).split("\n").slice(0, 5)).toEqual([
      m.landingHeroTitle({}, { locale }),
      m.landingSaleBannerStatus({}, { locale }),
      bannerSentence(banner),
      m.landingSaleBannerCta({}, { locale }),
      m.landingHeroSubtitle({}, { locale }),
    ]);
    expect(bannerSentence(banner)).toContain("*Summer* sale");
    expect(markdown).toContain(`**${banner.label.adjustment}**`);
    expect(markdownLinkUrls(markdown)[0]).toBe(
      `${origin}${banner.href.slice(`/${locale}`.length)}`
    );
  });

  test("leaves out the meeting room call to action while that page is unpublished", async () => {
    const markdown = await renderLandingPage(locale, false);

    expect(markdownPlainText(markdown)).not.toContain(
      m.landingHeroMeetingRoomCta({}, { locale })
    );
    expect(markdownLinkUrls(markdown)).not.toContain(`${origin}/meeting-room`);
    expect(markdownPlainText(markdown)).toContain(
      m.landingHeroPrimaryCta({}, { locale })
    );
  });
});
