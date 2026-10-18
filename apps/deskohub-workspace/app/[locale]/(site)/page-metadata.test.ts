import { describe, expect, mock, test } from "bun:test";
import type { Metadata } from "next";
import { locales } from "@/features/i18n";
import { publicPages } from "@/features/public-pages";

let requestLocale: string = "en-US";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve(requestLocale),
}));
mock.module(
  "@/features/meeting-room/backend/meeting-room-page-feature-flag",
  () => ({ isMeetingRoomPageEnabled: () => Promise.resolve(true) })
);
const officeFeatureFlag = await import(
  "@/features/office/backend/office-reservation-feature-flag.server"
);
mock.module(
  "@/features/office/backend/office-reservation-feature-flag.server",
  () => ({
    ...officeFeatureFlag,
    isOfficePageEnabled: () => Promise.resolve(true),
  })
);

type PageModule = { readonly generateMetadata: () => Promise<Metadata> };

// Route groups don't appear in URLs, so find each page file by its pathname.
const pageFileByPathname = new Map(
  Array.from(new Bun.Glob("**/page.tsx").scanSync(import.meta.dir), (file) => [
    `/${file
      .split("/")
      .slice(0, -1)
      .filter((segment) => !/^\(.+\)$/.test(segment))
      .join("/")}`,
    file,
  ])
);

describe("public page metadata", () => {
  for (const { pathname } of publicPages) {
    const suffix = pathname === "/" ? "" : pathname;

    for (const locale of locales) {
      test(`${pathname} in ${locale} is indexable with self-canonical and hreflang alternates`, async () => {
        const pageFile = pageFileByPathname.get(pathname);
        expect(pageFile).toBeDefined();
        requestLocale = locale;
        const page: PageModule = await import(`${import.meta.dir}/${pageFile}`);
        const metadata = await page.generateMetadata();

        expect(metadata.robots).toBeUndefined();
        expect(metadata.alternates).toEqual({
          canonical: `https://workspace.deskohub.cz/${locale}${suffix}`,
          languages: {
            "en-US": `https://workspace.deskohub.cz/en-US${suffix}`,
            "cs-CZ": `https://workspace.deskohub.cz/cs-CZ${suffix}`,
            "x-default": `https://workspace.deskohub.cz${pathname}`,
          },
        });
        if (metadata.openGraph) {
          expect(metadata.openGraph.url).toBe(
            `https://workspace.deskohub.cz/${locale}${suffix}`
          );
        }
      });
    }
  }
});

test("keeps the cookie settings redirect out of search results", async () => {
  const { metadata } = await import("./(minimal-header)/cookie-settings/page");

  expect(metadata.robots).toEqual({ index: false, follow: false });
});
