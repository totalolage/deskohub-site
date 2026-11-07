import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";

import { expect, test } from "bun:test";
import { RELEASE_CERTIFICATE_SHA256 } from "@/features/mobile-releases/android-app";
import type { AndroidRelease } from "@/features/mobile-releases/backend/latest-android-release.server";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import { markdownLinkUrls } from "@/shared/markdown/markdown.test-utils";
import {
  androidReleasesListUrl,
  getAndroidReleaseFacts,
} from "./android-download";
import { renderAndroidDownloadMarkdown } from "./android-download-page-markdown";
import { obtainiumImportUrl } from "./obtainium-link";

const release: AndroidRelease = {
  versionName: "1.2.3",
  versionCode: 10_203,
  apkUrl:
    "https://github.com/totalolage/deskohub-site/releases/download/mobile-v1.2.3/deskohub-1.2.3.apk",
  apkSizeBytes: 42_123_456,
  apkSha256: "ab".repeat(32),
  certificateSha256: RELEASE_CERTIFICATE_SHA256,
  publishedAt: "2026-11-05T09:30:00Z",
  releaseUrl:
    "https://github.com/totalolage/deskohub-site/releases/tag/mobile-v1.2.3",
};

test("lists the release's facts and links", () => {
  const markdown = serializeMarkdown(
    renderAndroidDownloadMarkdown("en-US", { kind: "release", release })
  );
  const facts = getAndroidReleaseFacts(release, "en-US");

  expect(markdownLinkUrls(markdown)).toEqual([
    release.apkUrl,
    obtainiumImportUrl,
  ]);
  for (const value of [facts.version, facts.size, facts.date]) {
    expect(markdown).toContain(value);
  }
  expect(markdown).toContain(RELEASE_CERTIFICATE_SHA256);
});

test("has no download links before the first release", () => {
  const markdown = serializeMarkdown(
    renderAndroidDownloadMarkdown("cs-CZ", { kind: "none" })
  );

  expect(markdownLinkUrls(markdown)).toEqual([]);
  expect(markdown).toContain(RELEASE_CERTIFICATE_SHA256);
});

test("links the releases list when the lookup fails", () => {
  const markdown = serializeMarkdown(
    renderAndroidDownloadMarkdown("cs-CZ", { kind: "unavailable" })
  );

  expect(markdownLinkUrls(markdown)).toEqual([androidReleasesListUrl]);
});
