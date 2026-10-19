import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Locator } from "@playwright/test";
import { type Locale, locales } from "@/features/i18n";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { m } from "./i18n";

// Short phones and a short laptop, where the navigation sections outgrow the
// screen.
const mobileViewports = [
  { height: 740, width: 390 },
  { height: 640, width: 390 },
] as const;
const desktopViewport = { height: 600, width: 1280 } as const;
// The narrowest phones the administration supports, where the header bar has
// the least room.
const narrowViewports = [
  { height: 640, width: 320 },
  { height: 640, width: 360 },
] as const;
const harnessOrigin = "http://admin-shell.test";
const lastLinkPath = "/admin/cli/sessions";

// The harness runs outside a Next.js app, so the router-bound modules render
// plain elements.
const nextModuleStubs: Readonly<Record<string, string>> = {
  "next/link": `
    import { createElement } from "react";
    export default function Link({ href, prefetch: _prefetch, ...props }) {
      return createElement("a", { ...props, href: String(href) });
    }
  `,
  "next/navigation": `
    export const usePathname = () => window.location.pathname;
    export const useSearchParams = () =>
      new URLSearchParams(window.location.search);
  `,
};

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let buildDirectory = "";
let browserBundlePath = "";
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "admin-shell-browser-"));
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "admin-shell.browser-harness.tsx")],
    format: "iife",
    minify: true,
    naming: "admin-shell-harness.js",
    outdir: buildDirectory,
    plugins: [browserModuleStubPlugin(nextModuleStubs)],
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  browserBundlePath = join(buildDirectory, "admin-shell-harness.js");

  appStyles = await compileWorkspaceAppStyles();

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory)
    await rm(buildDirectory, { force: true, recursive: true });
});

const openAdminShell = async (
  locale: Locale,
  viewport: { readonly height: number; readonly width: number }
) => {
  if (!browser) throw new Error("The AdminShell browser has not launched.");
  const page = await browser.newPage({ reducedMotion: "reduce", viewport });
  // The shell marks the current page from the URL, so the harness is served at
  // every administration address and a followed link loads it again.
  await page.route(`${harnessOrigin}/**`, (route) =>
    route.fulfill({
      body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="admin-shell-test-root" data-locale="${locale}"></div></body></html>`,
      contentType: "text/html",
    })
  );
  await page.goto(`${harnessOrigin}/${locale}/admin`);
  await page.addStyleTag({ content: appStyles });
  await page.addScriptTag({ path: browserBundlePath });
  await page.getByRole("link", { name: "Deskohub" }).first().waitFor();
  return page;
};

// Scrolls the link into view as far as its scroll containers allow, checks it
// ends up fully on screen, and follows it.
const reachAndFollow = async (
  link: Locator,
  viewport: { readonly height: number }
) => {
  await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox();
  if (!box) throw new Error("The last navigation link is not rendered.");
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await link.click();
};

for (const locale of locales) {
  for (const viewport of mobileViewports) {
    test.skipIf(!chromiumAvailable)(
      `reaches the last link of the ${locale} mobile navigation at ${viewport.width}×${viewport.height}`,
      async () => {
        const page = await openAdminShell(locale, viewport);
        try {
          await page
            .getByRole("button", {
              name: m.shellOpenNavigation({}, { locale }),
            })
            .click();
          const sheet = page.getByRole("dialog", {
            name: m.shellMobileNavigationTitle({}, { locale }),
          });
          await reachAndFollow(
            sheet.getByRole("link", {
              name: m.shellNavigationCliSessions({}, { locale }),
            }),
            viewport
          );
          await page.waitForURL(`${harnessOrigin}/${locale}${lastLinkPath}`);
        } finally {
          await page.close();
        }
      }
    );
  }

  test.skipIf(!chromiumAvailable)(
    `reaches the last link of the ${locale} desktop navigation at ${desktopViewport.width}×${desktopViewport.height}`,
    async () => {
      const page = await openAdminShell(locale, desktopViewport);
      try {
        await reachAndFollow(
          page.getByRole("complementary").getByRole("link", {
            name: m.shellNavigationCliSessions({}, { locale }),
          }),
          desktopViewport
        );
        await page.waitForURL(`${harnessOrigin}/${locale}${lastLinkPath}`);
      } finally {
        await page.close();
      }
    }
  );

  for (const viewport of narrowViewports) {
    test.skipIf(!chromiumAvailable)(
      `fits the ${locale} header bar in a ${viewport.width}px wide screen`,
      async () => {
        const page = await openAdminShell(locale, viewport);
        try {
          const header = page.getByRole("banner");
          await header
            .getByRole("navigation", {
              name: m.shellLanguageSwitcherLabel({}, { locale }),
            })
            .waitFor();
          const pageWidth = await page.evaluate(
            () => document.documentElement.scrollWidth
          );
          expect(pageWidth).toBeLessThanOrEqual(viewport.width);
          // A squeezed bar narrows the icon-only navigation button first.
          const menuButton = await header
            .getByRole("button", {
              name: m.shellOpenNavigation({}, { locale }),
            })
            .boundingBox();
          if (!menuButton) throw new Error("The menu button is not rendered.");
          expect(menuButton.width).toBe(menuButton.height);
          for (const control of await header
            .locator("a, button")
            .filter({ visible: true })
            .all()) {
            const box = await control.boundingBox();
            if (!box) continue;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
          }
        } finally {
          await page.close();
        }
      }
    );
  }
}
