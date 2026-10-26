import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { discountIdSchema } from "@/features/discounts/contracts";
import { workspaceProductFamilies } from "@/features/discounts/product-target";
import { getFaqQuestions } from "@/features/faq";
import { locales, m } from "@/features/i18n";
import type { PublicPageMarkdownSources } from "@/features/public-pages/public-page-markdown";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
  messagePlainText,
} from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
} from "@/shared/utils/workspace-location-map";
import type { LandingPageSaleBannerContent } from "./components/landing-page-sale-banner";
import { getLandingPageAmenities } from "./landing-page-amenities";
import { landingPageMarkdown } from "./landing-page-markdown";
import { getLandingPageSaleBannerContent } from "./landing-page-sale-banner-content";

const sources = (
  meetingRoomPublished: boolean,
  saleBanner?: LandingPageSaleBannerContent,
  officePublished = true
): PublicPageMarkdownSources => ({
  isPublished: (pathname) =>
    !(
      (pathname === "/meeting-room" && !meetingRoomPublished) ||
      (pathname === "/reservation/office" && !officePublished)
    ),
  offerings: Effect.succeed([]),
  saleBanner: Effect.succeed(saleBanner),
});

const renderLandingPage = async (
  locale: (typeof locales)[number],
  meetingRoomPublished: boolean,
  saleBanner?: LandingPageSaleBannerContent,
  officePublished = true
) =>
  serializeMarkdown(
    await Effect.runPromise(
      landingPageMarkdown(
        locale,
        sources(meetingRoomPublished, saleBanner, officePublished)
      )
    )
  );

/** The banner the HTML page shows for a 20% sale on every cowork product. */
const coworkSaleBanner = (locale: (typeof locales)[number]) =>
  getLandingPageSaleBannerContent({
    bookableProducts: workspaceProductFamilies,
    locale,
    reservationKind: "cowork",
    sale: {
      id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
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

  test("shows the hero, location, offering, amenities, questions and contact facts in page order", async () => {
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
        m.landingLocationTransport({}, { locale }),
        m.landingAccessTitle({}, { locale }),
        m.landingAccessStepBook({}, { locale }),
        m.landingAccessStepEmail({}, { locale }),
        m.landingAccessStepKeypad({}, { locale }),
        m.landingAccessStepStay({}, { locale }),
        m.landingLocationMapCta({}, { locale }),
        m.landingOfferingTitle({}, { locale }),
        messagePlainText(m.landingOfferingLead({}, { locale })),
        m.landingOfferingCoworkTitle({}, { locale }),
        `${getWorkspaceProductTierTitle("open-space", locale)}: ${m.landingOfferingOpenSpaceText({}, { locale })}`,
        `${getWorkspaceProductTierTitle("reserved-desk", locale)}: ${m.landingOfferingReservedDeskText({}, { locale })}`,
        m.coworkReservationLink({}, { locale }),
        m.landingOfferingCoworkPageLink({}, { locale }),
        getWorkspaceMeetingRoomProductTitle(locale),
        m.landingOfferingMeetingRoomText({}, { locale }),
        m.meetingRoomReservationLink({}, { locale }),
        m.landingOfferingMeetingRoomPageLink({}, { locale }),
        m.landingOfferingTtrpgTitle({}, { locale }),
        m.landingOfferingTtrpgText({}, { locale }),
        m.landingOfferingTtrpgLink({}, { locale }),
        messagePlainText(m.landingOfferingEvents({}, { locale })),
        m.landingAmenitiesTitle({}, { locale }),
        ...getLandingPageAmenities(locale).map(({ id, title, text }) =>
          id === "bar"
            ? `${title}: ${text} ${m.landingFooterBarCta({}, { locale })}`
            : `${title}: ${text}`
        ),
        m.landingFaqTeaserTitle({}, { locale }),
        ...getFaqQuestions(locale),
        m.landingFaqTeaserLink({}, { locale }),
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
      `${origin}/pricing`,
      `${origin}/reservation/cowork`,
      `${origin}/coworking`,
      `${origin}/reservation/meeting-room`,
      `${origin}/meeting-room`,
      `${origin}/ttrpg-room`,
      `${origin}/contact`,
      "https://bar.deskohub.cz/",
      `${origin}/faq`,
      `mailto:${infoEmail}`,
      `${origin}/contact`,
      "https://bar.deskohub.cz/",
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

  test("notes that private offices are not offered while office booking is unpublished", async () => {
    const offered = await renderLandingPage(locale, true);
    const unpublished = await renderLandingPage(locale, true, undefined, false);

    expect(markdownPlainText(offered)).not.toContain(
      m.landingOfferingOffices({}, { locale })
    );
    expect(markdownPlainText(unpublished)).toContain(
      `${messagePlainText(m.landingOfferingEvents({}, { locale }))} ${m.landingOfferingOffices({}, { locale })}`
    );
  });

  test("leaves out the meeting room call to action while that page is unpublished", async () => {
    const markdown = await renderLandingPage(locale, false);

    expect(markdownPlainText(markdown)).not.toContain(
      m.landingHeroMeetingRoomCta({}, { locale })
    );
    expect(markdownPlainText(markdown)).not.toContain(
      m.landingOfferingMeetingRoomPageLink({}, { locale })
    );
    expect(markdownLinkUrls(markdown)).not.toContain(`${origin}/meeting-room`);
    expect(markdownPlainText(markdown)).toContain(
      m.landingHeroPrimaryCta({}, { locale })
    );
  });
});
