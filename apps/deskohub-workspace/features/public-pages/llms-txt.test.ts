import { describe, expect, test } from "bun:test";
import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import { advertisedCatalogOfferings } from "@/features/checkout/public-offerings.test-utils";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
} from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { llmsTxtMarkdown } from "./llms-txt";
import { findLocalizedPublicPage } from "./page-markdown-negotiation";
import { publicPageMarkdown } from "./public-page-markdown";
import { type PublicPagePathname, publicPages } from "./public-pages";
import { getWorkspaceSummary } from "./workspace-summary";

const allPages = publicPages.map(({ pathname }) => pathname);
const locale = "en-US";

const renderLlmsTxt = (
  pages: ReadonlyArray<PublicPagePathname> = allPages,
  officeOpen = true
) =>
  serializeMarkdown(
    llmsTxtMarkdown({
      pages,
      offerings: advertisedCatalogOfferings({
        locale,
        ...(officeOpen && { office: {} }),
      }),
    })
  );

const headings = (markdown: string, depth: number) =>
  markdown
    .split("\n")
    .filter((line) => line.startsWith(`${"#".repeat(depth)} `))
    .map((line) => line.slice(depth + 1));

describe("llmsTxtMarkdown", () => {
  test("opens with the business name, a summary and the opening hours", () => {
    const markdown = renderLlmsTxt();
    const [title, summary, openingHours] = markdown.split("\n\n");

    expect(title).toBe(`# ${workspaceSiteConstants.brand.name}`);
    expect(summary).toBe(
      `> ${getWorkspaceSummary({
        locale,
        offerings: advertisedCatalogOfferings({ locale, office: {} }),
      })}`
    );
    expect(markdownPlainText(openingHours ?? "")).toBe(
      getPublicOpeningHours(locale)
    );
  });

  test("lists pages by topic in English section order", () => {
    const markdown = renderLlmsTxt();

    // One list per section keeps every bullet a `-`, as llms.txt shows them.
    expect(markdown).not.toMatch(/^\* /m);
    expect(headings(markdown, 2)).toEqual([
      m.publicPageTopicOffer({}, { locale }),
      m.publicPageTopicBooking({}, { locale }),
      m.landingNavPricing({}, { locale }),
      m.landingNavContactLabel({}, { locale }),
      m.footerLegalLabel({}, { locale }),
      "Optional",
    ]);
  });

  test("links each listed page in every locale with absolute URLs", () => {
    const urls = markdownLinkUrls(renderLlmsTxt());
    const pageUrls = urls.filter((url) => !url.startsWith("mailto:"));

    for (const url of urls) {
      expect(url).toMatch(/^(https:\/\/workspace\.deskohub\.cz\/|mailto:)/);
    }
    expect(pageUrls).toHaveLength(allPages.length * locales.length);
    for (const pathname of allPages) {
      for (const pageLocale of locales) {
        expect(
          pageUrls.filter(
            (url) =>
              findLocalizedPublicPage(new URL(url).pathname)?.pathname ===
                pathname &&
              findLocalizedPublicPage(new URL(url).pathname)?.locale ===
                pageLocale
          )
        ).toHaveLength(1);
      }
    }
  });

  test("names each page by its English title", () => {
    const text = markdownPlainText(renderLlmsTxt());

    for (const pathname of allPages) {
      expect(text).toContain(publicPageMarkdown[pathname].title(locale));
    }
  });

  test("lists only the public pages it is given", () => {
    const published = allPages.filter(
      (pathname) =>
        pathname !== "/meeting-room" && pathname !== "/reservation/office"
    );
    const pageUrls = markdownLinkUrls(renderLlmsTxt(published, false)).filter(
      (url) => url.startsWith("https://")
    );

    const listed = new Set(
      pageUrls.map(
        (url) => findLocalizedPublicPage(new URL(url).pathname)?.pathname
      )
    );

    expect([...listed].sort()).toEqual([...published].sort());
  });

  test("lists every offering under the prices and the contact email", () => {
    const text = markdownPlainText(renderLlmsTxt());

    for (const offering of advertisedCatalogOfferings({ locale, office: {} })) {
      expect(text).toContain(offering.name);
    }
    expect(markdownLinkUrls(renderLlmsTxt())).toContain(
      `mailto:${workspaceSiteConstants.contact.infoEmail}`
    );
  });
});

describe("llms.txt facts", () => {
  const summaryAndOpeningHours = (officeOpen: boolean) => {
    const [, summary = "", openingHours = ""] = renderLlmsTxt(
      allPages,
      officeOpen
    ).split("\n\n");
    return {
      summary: markdownPlainText(summary),
      openingHours: markdownPlainText(openingHours),
    };
  };

  test("summarizes the address from the site constants", () => {
    const { summary } = summaryAndOpeningHours(true);
    const { street, cityDistrict, city, postalCode } =
      workspaceSiteConstants.location.address;

    for (const field of [street, cityDistrict, city, postalCode]) {
      expect(summary).toContain(field);
    }
  });

  test("names each offered product once, and no other", () => {
    const productNames = (officeOpen: boolean) =>
      new Set(
        advertisedCatalogOfferings({
          locale,
          ...(officeOpen && { office: {} }),
        }).map(({ name }) => name)
      );
    const allNames = productNames(true);

    for (const officeOpen of [true, false]) {
      const { summary } = summaryAndOpeningHours(officeOpen);
      const offered = productNames(officeOpen);

      for (const name of allNames) {
        expect(summary.split(name)).toHaveLength(offered.has(name) ? 2 : 1);
      }
    }
    expect(productNames(false).size).toBeLessThan(allNames.size);
  });

  test("states the Open Space cut-off from the site constants", () => {
    const { openingHours } = summaryAndOpeningHours(true);

    expect(openingHours).toContain(
      workspaceSiteConstants.openingHours.openSpaceUsableUntil
    );
  });
});
