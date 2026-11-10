import "@/shared/polyfills/temporal";

import { expect, test } from "bun:test";
import { Temporal as PolyfillTemporal } from "@js-temporal/polyfill";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import type { AndroidRelease } from "@/features/mobile-releases/backend/latest-android-release.server";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getAndroidReleaseFacts } from "./android-download";

const release: AndroidRelease = {
  versionName: "1.2.3",
  versionCode: 10_203,
  apkUrl:
    "https://github.com/totalolage/deskohub-site/releases/download/mobile-v1.2.3/deskohub-1.2.3.apk",
  apkSizeBytes: 42_123_456,
  apkSha256: "ab".repeat(32),
  certificateSha256: nativeApp.androidReleaseCertificate,
  // Already the next day in Prague, where the page dates releases.
  publishedAt: "2026-11-05T23:30:00Z",
  releaseUrl:
    "https://github.com/totalolage/deskohub-site/releases/tag/mobile-v1.2.3",
};

/**
 * Runs `render` as a production prerender does: on Node.js, which has no
 * native Temporal, so on the polyfill, and with a `Date` that throws on a
 * read of the current time, as Next.js fails a prerender on `Date.now()` or
 * `new Date()`.
 */
const asPrerendered = <A>(render: () => A): A => {
  const RealDate = globalThis.Date;
  const RealTemporal = globalThis.Temporal;
  const setTemporal = (value: typeof RealTemporal | typeof PolyfillTemporal) =>
    Object.defineProperty(globalThis, "Temporal", {
      configurable: true,
      writable: true,
      value,
    });
  setTemporal(PolyfillTemporal);
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => {
      if (args.length === 0) {
        throw new Error("The current time was read during a prerender.");
      }
      return Reflect.construct(target, args, newTarget);
    },
    get: (target, property, receiver) =>
      property === "now"
        ? () => {
            throw new Error("The current time was read during a prerender.");
          }
        : Reflect.get(target, property, receiver),
  });
  try {
    return render();
  } finally {
    globalThis.Date = RealDate;
    setTemporal(RealTemporal);
  }
};

// The `/android` page renders the latest release while it prerenders,
// outside any cache scope.
test("formats a release's facts without reading the current time", () => {
  const facts = asPrerendered(() => getAndroidReleaseFacts(release, "cs-CZ"));

  expect(facts.version).toBe(release.versionName);
  expect(facts.date).toBe(
    formatInstantDate({
      instant: Temporal.Instant.from(release.publishedAt),
      locale: "cs-CZ",
      dateStyle: "long",
      timeZone: workspaceSiteConstants.location.timeZone,
    })
  );
});
