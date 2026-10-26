import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type Locale, locales } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { publicSiteShareImage } from "../page-metadata";
import {
  type PublicPageReleaseGate,
  publicPages,
} from "../public-page-definitions";

let requestLocale: Locale = "en-US";
const openGates = new Set<PublicPageReleaseGate>();
const isMeetingRoomPageEnabled = mock(() =>
  Promise.resolve(openGates.has("meeting-room-page"))
);
const isOfficePageEnabled = mock(() =>
  Promise.resolve(openGates.has("office-page"))
);

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve(requestLocale),
}));
const meetingRoomFeatureFlag = await import(
  "@/features/meeting-room/backend/meeting-room-page-feature-flag"
);
mock.module(
  "@/features/meeting-room/backend/meeting-room-page-feature-flag",
  () => ({ ...meetingRoomFeatureFlag, isMeetingRoomPageEnabled })
);
const officeFeatureFlag = await import(
  "@/features/office/backend/office-reservation-feature-flag.server"
);
mock.module(
  "@/features/office/backend/office-reservation-feature-flag.server",
  () => ({ ...officeFeatureFlag, isOfficePageEnabled })
);

const { publicPageMetadata, requirePublishedPublicPage } = await import(
  "./public-page-route.server"
);

const notFound = "NEXT_HTTP_ERROR_FALLBACK;404";

const openGraphLocales = { "en-US": "en_US", "cs-CZ": "cs_CZ" } as const;

const pageMetadata = (pathname: (typeof publicPages)[number]["pathname"]) =>
  publicPageMetadata(pathname)();

beforeEach(() => {
  requestLocale = "en-US";
  openGates.clear();
  isMeetingRoomPageEnabled.mockClear();
  isOfficePageEnabled.mockClear();
});

describe("public page metadata", () => {
  for (const { pathname, title, article } of publicPages) {
    const suffix = pathname === "/" ? "" : pathname;

    for (const locale of locales) {
      test(`${pathname} in ${locale} is indexable with self-canonical and hreflang alternates and a share card`, async () => {
        requestLocale = locale;
        openGates.add("meeting-room-page").add("office-page");
        const metadata = await pageMetadata(pathname);
        const documentTitle = `${title({}, { locale })} | ${workspaceSiteConstants.brand.name}`;

        expect(metadata.robots).toBeUndefined();
        expect(metadata.title).toBe(documentTitle);
        expect(metadata.alternates).toEqual({
          canonical: `https://workspace.deskohub.cz/${locale}${suffix}`,
          languages: {
            "en-US": `https://workspace.deskohub.cz/en-US${suffix}`,
            "cs-CZ": `https://workspace.deskohub.cz/cs-CZ${suffix}`,
            "x-default": `https://workspace.deskohub.cz${pathname}`,
          },
        });
        expect(metadata.openGraph).toMatchObject({
          type: article ? "article" : "website",
          title: documentTitle,
          url: `https://workspace.deskohub.cz/${locale}${suffix}`,
          siteName: workspaceSiteConstants.brand.name,
          locale: openGraphLocales[locale],
          alternateLocale: locales
            .filter((alternateLocale) => alternateLocale !== locale)
            .map((alternateLocale) => openGraphLocales[alternateLocale]),
          images: [publicSiteShareImage],
        });
        expect(metadata.twitter).toEqual({ card: "summary_large_image" });
      });
    }
  }
});

describe("public page release gates", () => {
  for (const { pathname, releaseGate } of publicPages) {
    if (releaseGate === undefined) {
      test(`${pathname} is served without evaluating a gate`, async () => {
        await expect(
          requirePublishedPublicPage(pathname)
        ).resolves.toBeUndefined();
        await expect(pageMetadata(pathname)).resolves.toBeDefined();
        expect(isMeetingRoomPageEnabled).not.toHaveBeenCalled();
        expect(isOfficePageEnabled).not.toHaveBeenCalled();
      });
      continue;
    }

    test(`${pathname} is not found in its metadata and body while ${releaseGate} is off`, async () => {
      // Every other gate is open, so only the page's own gate closes it.
      openGates.add("meeting-room-page").add("office-page");
      openGates.delete(releaseGate);

      await expect(requirePublishedPublicPage(pathname)).rejects.toThrow(
        notFound
      );
      await expect(pageMetadata(pathname)).rejects.toThrow(notFound);
    });

    test(`${pathname} is served while ${releaseGate} is on`, async () => {
      openGates.add(releaseGate);

      await expect(
        requirePublishedPublicPage(pathname)
      ).resolves.toBeUndefined();
      await expect(pageMetadata(pathname)).resolves.toBeDefined();
    });
  }
});
