import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type Locale, locales } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
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

beforeEach(() => {
  requestLocale = "en-US";
  openGates.clear();
  isMeetingRoomPageEnabled.mockClear();
  isOfficePageEnabled.mockClear();
});

describe("public page metadata", () => {
  for (const { pathname, title, document } of publicPages) {
    const suffix = pathname === "/" ? "" : pathname;

    for (const locale of locales) {
      test(`${pathname} in ${locale} is indexable with self-canonical and hreflang alternates`, async () => {
        requestLocale = locale;
        openGates.add("meeting-room-page").add("office-page");
        const metadata = await publicPageMetadata(pathname)();
        const pageTitle = title({}, { locale });

        expect(metadata.robots).toBeUndefined();
        expect(metadata.alternates).toEqual({
          canonical: `https://workspace.deskohub.cz/${locale}${suffix}`,
          languages: {
            "en-US": `https://workspace.deskohub.cz/en-US${suffix}`,
            "cs-CZ": `https://workspace.deskohub.cz/cs-CZ${suffix}`,
            "x-default": `https://workspace.deskohub.cz${pathname}`,
          },
        });
        expect(metadata.title).toBe(
          document
            ? `${pageTitle} | ${workspaceSiteConstants.brand.name}`
            : pageTitle
        );
        expect(metadata.openGraph).toMatchObject({
          title: pageTitle,
          url: `https://workspace.deskohub.cz/${locale}${suffix}`,
          siteName: workspaceSiteConstants.brand.name,
          locale,
        });
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
        await expect(publicPageMetadata(pathname)()).resolves.toBeDefined();
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
      await expect(publicPageMetadata(pathname)()).rejects.toThrow(notFound);
    });

    test(`${pathname} is served while ${releaseGate} is on`, async () => {
      openGates.add(releaseGate);

      await expect(
        requirePublishedPublicPage(pathname)
      ).resolves.toBeUndefined();
      await expect(publicPageMetadata(pathname)()).resolves.toBeDefined();
    });
  }
});
