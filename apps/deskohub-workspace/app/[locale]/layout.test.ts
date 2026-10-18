import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";

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
      expect(metadata.description).toContain("Turnovská 430/10");
      expect(metadata.description).not.toContain("shell application");
    }
    expect(english.description).toContain("Open Space, Reserved Desk");
    expect(czech.description).toContain("vyhrazené místo");
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
