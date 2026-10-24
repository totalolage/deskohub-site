import { describe, expect, test } from "bun:test";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  createPublicPageMetadata,
  getPublicPageTitle,
  type ParentMetadata,
} from "./page-metadata";

const shareImage = {
  url: "https://workspace.deskohub.cz/cs-CZ/opengraph-image.jpg?0123456789abcdef",
  width: 1200,
  height: 630,
  type: "image/jpeg",
};

// The layouts' metadata as Next resolves it, with the share image the
// `opengraph-image` file adds.
const parent: ParentMetadata = Promise.resolve({
  openGraph: { images: [shareImage] },
});

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
  test("gives the page a complete Open Graph and Twitter card", async () => {
    const metadata = await createPublicPageMetadata(
      {
        locale: "cs-CZ",
        pathname: "/faq",
        title: { page: "Page" },
        description: "Description",
      },
      parent
    );

    expect(metadata).toEqual({
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
        images: [shareImage],
      },
      twitter: { card: "summary_large_image" },
    });
  });

  test("names the other locales as Open Graph alternates", async () => {
    const { openGraph } = await createPublicPageMetadata(
      { locale: "en-US", pathname: "/", title: { page: "Page" } },
      parent
    );

    expect(openGraph).toMatchObject({
      locale: "en_US",
      alternateLocale: ["cs_CZ"],
      url: "https://workspace.deskohub.cz/en-US",
    });
  });

  test("leaves the description to the layout when the page has none", async () => {
    const metadata = await createPublicPageMetadata(
      { locale: "en-US", pathname: "/logo", title: { page: "Page" } },
      parent
    );

    expect(metadata).not.toHaveProperty("description");
    expect(metadata.openGraph).not.toHaveProperty("description");
  });

  test("marks an article as one", async () => {
    const { openGraph } = await createPublicPageMetadata(
      {
        locale: "en-US",
        pathname: "/privacy-policy",
        title: { page: "Page" },
        description: "Description",
        type: "article",
      },
      parent
    );

    expect(openGraph).toMatchObject({ type: "article" });
  });
});
