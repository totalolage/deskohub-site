import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import type { AndroidRelease } from "@/features/mobile-releases/backend/latest-android-release.server";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { formatFileSize } from "@/shared/utils/number";
import type { AndroidDownload } from "../android-download";
import { obtainiumImportUrl } from "../obtainium-link";

registerWorkspaceComponentTestEnv();

mock.module("next/image", () => ({
  // Bun resolves static image imports to their file path.
  default: ({ alt, src }: { readonly alt: string; readonly src: string }) => (
    // biome-ignore lint/performance/noImgElement: stands in for next/image.
    <img alt={alt} src={src} />
  ),
}));

const { AndroidDownloadPage } = await import("./android-download-page");

const releasesListUrl = "https://github.com/totalolage/deskohub-site/releases";

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

const renderPage = (download: AndroidDownload) =>
  render(<AndroidDownloadPage download={download} locale="cs-CZ" />);

type RenderedPage = ReturnType<typeof renderPage>;

const linksTo = (page: RenderedPage, href: string) =>
  page
    .queryAllByRole("link")
    .filter((link) => link.getAttribute("href") === href);

afterEach(() => {
  cleanup();
});

afterAll(() => unregisterWorkspaceComponentTestEnv());

/** Every state shows the pinned certificate and the three install steps. */
const expectCertificateAndSteps = (page: RenderedPage) => {
  expect(page.getByRole("heading", { level: 1 })).toBeDefined();
  expect(page.getByText(nativeApp.androidReleaseCertificate).tagName).toBe(
    "CODE"
  );
  const steps = page.container.querySelector("ol");
  expect(steps).not.toBeNull();
  expect(within(steps as HTMLElement).getAllByRole("listitem")).toHaveLength(3);
};

test("offers the latest release's APK and the Obtainium import", () => {
  const page = renderPage({ kind: "release", release });

  const [apkLink] = linksTo(page, release.apkUrl);
  expect(apkLink).toBeDefined();
  expect(apkLink?.getAttribute("href")).toEndWith("/deskohub-1.2.3.apk");

  const [obtainiumLink] = linksTo(page, obtainiumImportUrl);
  expect(obtainiumLink).toBeDefined();
  const badge = within(obtainiumLink as HTMLElement).getByRole("img");
  expect(badge.getAttribute("alt")).not.toBe("");

  expect(page.getByText(release.versionName)).toBeDefined();
  const date = page.container.querySelector("time");
  expect(date?.getAttribute("datetime")).toBe(release.publishedAt);
  expect(date?.textContent).toBe(
    new Intl.DateTimeFormat("cs-CZ", {
      dateStyle: "long",
      timeZone: "Europe/Prague",
    }).format(new Date("2026-11-06T12:00:00Z"))
  );
  const size = page.container.querySelector("data");
  expect(size?.getAttribute("value")).toBe(String(release.apkSizeBytes));
  expect(size?.textContent).toBe(formatFileSize(release.apkSizeBytes, "cs-CZ"));
  expect(linksTo(page, releasesListUrl)).toHaveLength(0);
  expectCertificateAndSteps(page);
});

test("shows the certificate and steps without download links before the first release", () => {
  const page = renderPage({ kind: "none" });

  expect(page.queryAllByRole("link")).toHaveLength(0);
  expect(page.container.querySelector("time")).toBeNull();
  expect(page.container.querySelector("data")).toBeNull();
  expectCertificateAndSteps(page);
});

test("falls back to the releases list when the lookup fails", () => {
  const page = renderPage({ kind: "unavailable" });

  expect(linksTo(page, releasesListUrl)).toHaveLength(1);
  expect(linksTo(page, obtainiumImportUrl)).toHaveLength(0);
  expect(page.queryAllByRole("link")).toHaveLength(1);
  expect(page.container.querySelector("time")).toBeNull();
  expect(page.container.querySelector("data")).toBeNull();
  expectCertificateAndSteps(page);
});
