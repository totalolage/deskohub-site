import type { Locale } from "@/features/i18n";
import type { AndroidRelease } from "@/features/mobile-releases/backend/latest-android-release.server";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import { formatFileSize } from "@/shared/utils/number";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/** What the `/android` page can offer, from the latest release lookup. */
export type AndroidDownload =
  | { readonly kind: "release"; readonly release: AndroidRelease }
  /** No release has been published yet. */
  | { readonly kind: "none" }
  /** The lookup failed, so the page links to the releases list instead. */
  | { readonly kind: "unavailable" };

/** Every published release, for when the latest one can't be looked up. */
export const androidReleasesListUrl =
  "https://github.com/totalolage/deskohub-site/releases";

/**
 * The release facts the page and its Markdown variant show, formatted for
 * `locale`. Format them on the server: the date reads the site's time zone.
 */
export const getAndroidReleaseFacts = (
  release: AndroidRelease,
  locale: Locale
) => ({
  version: release.versionName,
  size: formatFileSize(release.apkSizeBytes, locale),
  date: formatInstantDate({
    // Not `Temporal.Instant.from`: the Temporal polyfill Node.js runs on
    // constructs `new Date()` while parsing a string, which fails the
    // prerender of `/android` as a read of the current time.
    instant: Temporal.Instant.fromEpochMilliseconds(
      Date.parse(release.publishedAt)
    ),
    locale,
    dateStyle: "long",
    timeZone: workspaceSiteConstants.location.timeZone,
  }),
});
