import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
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
import { landingPageMarkdown } from "./landing-page-markdown";

const sources = (meetingRoomPublished: boolean): PublicPageMarkdownSources => ({
  isPublished: (pathname) =>
    pathname !== "/meeting-room" || meetingRoomPublished,
  offerings: Effect.succeed([]),
});

const renderLandingPage = async (
  locale: (typeof locales)[number],
  meetingRoomPublished: boolean
) =>
  serializeMarkdown(
    await Effect.runPromise(
      landingPageMarkdown(locale, sources(meetingRoomPublished))
    )
  );

// Left out on purpose: the metadata title and description, which the page
// sends as metadata; the hero image, carousel and map labels and alt text
// (landingHeroImageAlt, landingCarousel*, landingLocationMapAlt); the
// decorative contact badge (landingNavContactLabel); and the sale banner
// (landingSaleBanner*), which reads a flag per request.
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

  test("links each call to action to its absolute target", async () => {
    const markdown = await renderLandingPage(locale, true);

    expect(markdownLinkUrls(markdown)).toEqual([
      `${origin}/${locale}/meeting-room`,
      `${origin}/${locale}/reservation/cowork`,
      `${origin}/${locale}/contact`,
      workspaceGoogleDirectionsUrl,
      `mailto:${infoEmail}`,
      `${origin}/${locale}/contact`,
      `${origin}/${locale}#overview`,
    ]);
  });

  test("leaves out the meeting room call to action while that page is unpublished", async () => {
    const markdown = await renderLandingPage(locale, false);

    expect(markdownPlainText(markdown)).not.toContain(
      m.landingHeroMeetingRoomCta({}, { locale })
    );
    expect(markdownLinkUrls(markdown)).not.toContain(
      `${origin}/${locale}/meeting-room`
    );
    expect(markdownPlainText(markdown)).toContain(
      m.landingHeroPrimaryCta({}, { locale })
    );
  });
});
