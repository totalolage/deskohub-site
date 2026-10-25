import { describe, expect, test } from "bun:test";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  createNoindexedPageMetadata,
  createPublicPageMetadata,
  getPublicPageTitle,
  publicSiteShareImage,
} from "./page-metadata";

describe("getPublicPageTitle", () => {
  test("appends the site name to a page's own title", () => {
    expect(getPublicPageTitle({ page: "Page" })).toBe(
      `Page | ${workspaceSiteConstants.brand.name}`
    );
  });

  test("keeps a title written in full", () => {
    expect(getPublicPageTitle({ absolute: "Full title" })).toBe("Full title");
  });
});

describe("createPublicPageMetadata", () => {
  test("gives the page a complete Open Graph and Twitter card", () => {
    expect(
      createPublicPageMetadata({
        locale: "cs-CZ",
        pathname: "/faq",
        title: { page: "Page" },
        description: "Description",
      })
    ).toEqual({
      title: getPublicPageTitle({ page: "Page" }),
      description: "Description",
      alternates: {
        canonical: "https://workspace.deskohub.cz/cs-CZ/faq",
        languages: {
          "en-US": "https://workspace.deskohub.cz/en-US/faq",
          "cs-CZ": "https://workspace.deskohub.cz/cs-CZ/faq",
          "x-default": "https://workspace.deskohub.cz/faq",
        },
      },
      openGraph: {
        type: "website",
        title: getPublicPageTitle({ page: "Page" }),
        description: "Description",
        url: "https://workspace.deskohub.cz/cs-CZ/faq",
        siteName: workspaceSiteConstants.brand.name,
        locale: "cs_CZ",
        alternateLocale: ["en_US"],
        images: [publicSiteShareImage],
      },
      twitter: { card: "summary_large_image" },
    });
  });

  test("names the other locales as Open Graph alternates", () => {
    const { openGraph } = createPublicPageMetadata({
      locale: "en-US",
      pathname: "/",
      title: { page: "Page" },
    });

    expect(openGraph).toMatchObject({
      locale: "en_US",
      alternateLocale: ["cs_CZ"],
      url: "https://workspace.deskohub.cz/en-US",
    });
  });

  test("leaves the description to the layout when the page has none", () => {
    const metadata = createPublicPageMetadata({
      locale: "en-US",
      pathname: "/logo",
      title: { page: "Page" },
    });

    expect(metadata).not.toHaveProperty("description");
    expect(metadata.openGraph).not.toHaveProperty("description");
  });

  test("marks an article as one", () => {
    const { openGraph } = createPublicPageMetadata({
      locale: "en-US",
      pathname: "/privacy-policy",
      title: { page: "Page" },
      description: "Description",
      type: "article",
    });

    expect(openGraph).toMatchObject({ type: "article" });
  });
});

describe("createNoindexedPageMetadata", () => {
  test("keeps the share card but names no URL for crawlers", () => {
    const metadata = createNoindexedPageMetadata({
      locale: "cs-CZ",
      title: { absolute: "Full title" },
      description: "Description",
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata).not.toHaveProperty("alternates");
    expect(metadata.openGraph).not.toHaveProperty("url");
    expect(metadata.openGraph).toMatchObject({
      locale: "cs_CZ",
      images: [publicSiteShareImage],
    });
    expect(metadata.twitter).toEqual({ card: "summary_large_image" });
  });
});
