import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { getPublicCatalogOfferings } from "@/features/checkout/public-offerings";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

mock.module("next/font/local", () => ({
  default: () => ({ variable: "--font-sculpin" }),
}));

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
      // Office reservations open by a release gate the layout does not read.
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
