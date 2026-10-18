import { describe, expect, mock, test } from "bun:test";
import type { Metadata } from "next";
import { locales } from "@/features/i18n";

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

const publicPages: ReadonlyArray<
  readonly [pathname: string, load: () => Promise<PageModule>]
> = [
  ["", () => import("./(full-header)/page")],
  ["/contact", () => import("./(full-header)/contact/page")],
  ["/faq", () => import("./(full-header)/faq/page")],
  ["/meeting-room", () => import("./(full-header)/meeting-room/page")],
  ["/team", () => import("./(full-header)/team/page")],
  ["/ttrpg-room", () => import("./(full-header)/ttrpg-room/page")],
  ["/cookie-policy", () => import("./(full-header)/cookie-policy/page")],
  [
    "/marketing-communications",
    () => import("./(full-header)/marketing-communications/page"),
  ],
  ["/operating-rules", () => import("./(full-header)/operating-rules/page")],
  ["/privacy-policy", () => import("./(full-header)/privacy-policy/page")],
  [
    "/terms-and-conditions",
    () => import("./(full-header)/terms-and-conditions/page"),
  ],
  [
    "/reservation/cowork",
    () => import("./(minimal-header)/reservation/cowork/page"),
  ],
  [
    "/reservation/meeting-room",
    () => import("./(minimal-header)/reservation/meeting-room/page"),
  ],
  [
    "/reservation/office",
    () => import("./(minimal-header)/reservation/office/page"),
  ],
  ["/logo", () => import("./(minimal-header)/logo/page")],
];

describe("public page metadata", () => {
  for (const [pathname, load] of publicPages) {
    for (const locale of locales) {
      test(`${pathname || "/"} in ${locale} is indexable with self-canonical and hreflang alternates`, async () => {
        requestLocale = locale;
        const metadata = await (await load()).generateMetadata();

        expect(metadata.robots).toBeUndefined();
        expect(metadata.alternates).toEqual({
          canonical: `https://workspace.deskohub.cz/${locale}${pathname}`,
          languages: {
            "en-US": `https://workspace.deskohub.cz/en-US${pathname}`,
            "cs-CZ": `https://workspace.deskohub.cz/cs-CZ${pathname}`,
            "x-default": `https://workspace.deskohub.cz${pathname || "/"}`,
          },
        });
        if (metadata.openGraph) {
          expect(metadata.openGraph.url).toBe(
            `https://workspace.deskohub.cz/${locale}${pathname}`
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
