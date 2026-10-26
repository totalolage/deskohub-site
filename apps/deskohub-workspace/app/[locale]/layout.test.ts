import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { getPublicCatalogOfferings } from "@/features/checkout/public-offerings";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";
import { publicSiteShareImage } from "@/features/public-pages/page-metadata";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

mock.module("next/font/local", () => ({
  default: () => ({ variable: "--font-sculpin" }),
}));

// Outside a Next.js render there is no cache to configure.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, cacheLife: () => {} }));

// The flags that are the same for every visitor; any other is decided per
// visitor.
let constantFlags: Partial<Record<PostHogFeatureFlagKey, boolean>> = {};
mock.module(
  "@/features/feature-flags/backend/feature-flag-evaluation-mode.server",
  () => ({
    getGlobalWorkspaceFeatureFlagValues: () => Promise.resolve(undefined),
    getGlobalWorkspaceFeatureFlagValue: (key: PostHogFeatureFlagKey) =>
      Promise.resolve(constantFlags[key]),
  })
);

const page = createElement("page");

describe("localized route layout", () => {
  test("describes the coworking space in each locale against the site origin", async () => {
    const { generateMetadata } = await import("./layout");
    const english = await generateMetadata({
      params: Promise.resolve({ locale: "en-US" }),
    });
    const czech = await generateMetadata({
      params: Promise.resolve({ locale: "cs-CZ" }),
    });

    for (const metadata of [english, czech]) {
      expect(metadata.metadataBase?.href).toBe(
        "https://workspace.deskohub.cz/"
      );
      expect(metadata.description).toContain(
        workspaceSiteConstants.location.address.street
      );
      expect(metadata.description).not.toContain("shell application");
    }
    for (const [locale, metadata] of [
      ["en-US", english],
      ["cs-CZ", czech],
    ] as const) {
      // No flag is the same for every visitor here, so the office stays out.
      for (const { kind, name } of getPublicCatalogOfferings({
        locale,
        office: {},
      })) {
        if (kind === "office") {
          expect(metadata.description).not.toContain(name);
        } else {
          expect(metadata.description).toContain(name);
        }
      }
    }
    expect(czech.description).not.toEqual(english.description);
    expect(czech.title).not.toEqual(english.title);
  });

  test("names the office only while it is open for every visitor", async () => {
    const { generateMetadata } = await import("./layout");

    for (const officePage of [true, false, undefined]) {
      constantFlags =
        officePage === undefined ? {} : { office_page: officePage };

      for (const locale of ["en-US", "cs-CZ"] as const) {
        const { description } = await generateMetadata({
          params: Promise.resolve({ locale }),
        });
        const office = getPublicCatalogOfferings({ locale, office: {} }).find(
          ({ kind }) => kind === "office"
        );
        if (!office) throw new Error("The catalog has no office offering.");

        if (officePage === true) {
          expect(description).toContain(office.name);
        } else {
          expect(description).not.toContain(office.name);
        }
      }
    }
    constantFlags = {};
  });

  test("links icons that the app serves, a share image and a theme colour", async () => {
    const { generateMetadata, viewport } = await import("./layout");
    type Icon = { url: string; type: string };
    const { icons, openGraph } = await generateMetadata({
      params: Promise.resolve({ locale: "en-US" }),
    });
    const { icon, apple } = icons as { icon: Icon[]; apple: Icon };
    const linked = [...icon, apple];

    expect(linked.map(({ type }) => type)).toEqual([
      "image/x-icon",
      "image/svg+xml",
      "image/png",
      "image/png",
    ]);
    for (const { url } of linked) {
      // `/favicon.png` is rendered from `/favicon.svg` by its route.
      const file =
        url === "/favicon.png"
          ? new URL("../favicon.png/route.ts", import.meta.url)
          : new URL(`../../public${url}`, import.meta.url);
      expect(await Bun.file(file).exists()).toBe(true);
    }
    expect(openGraph?.images).toEqual([publicSiteShareImage]);
    expect(viewport.themeColor).toBeDefined();
  });

  test("starts the document head with the Temporal loader", async () => {
    const { default: LocaleLayout } = await import("./layout");
    const { TemporalLoader } = await import(
      "@/shared/polyfills/temporal-loader"
    );
    type Element = { type: unknown; props: { children?: unknown } };
    const html = (await LocaleLayout({
      children: page,
      params: Promise.resolve({ locale: "en-US" }),
    })) as Element;
    const [head] = [html.props.children].flat() as Element[];
    const [first] = [head?.props.children].flat() as Element[];

    expect(head?.type).toBe("head");
    expect(first?.type).toBe(TemporalLoader);
  });

  test("rejects an unknown locale", async () => {
    const { default: LocaleLayout } = await import("./layout");
    await expect(
      LocaleLayout({
        children: page,
        params: Promise.resolve({ locale: "xx-XX" }),
      })
    ).rejects.toThrow();
  });
});
