import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { getAccountPageTitle } from "@/features/account/page-title";
import {
  getAccountPath,
  getAccountSectionPath,
} from "@/features/account/routes";
import {
  type AccountPageSection,
  accountSections,
  isAccountPageSection,
} from "@/features/account/sections";
import { type Locale, locales } from "@/features/i18n";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";

const harnessOrigin = "http://account-layout-shell.test";
const pageSections = accountSections.filter(isAccountPageSection);

// The harness runs outside a Next.js app: the shell reads its path from the
// URL, and navigations to another page are not part of these cases.
const nextModuleStubs: Readonly<Record<string, string>> = {
  "next/link": `
    import { createElement } from "react";
    export default function Link({ href, onNavigate: _onNavigate, prefetch: _prefetch, scroll: _scroll, ...props }) {
      return createElement("a", { ...props, href: String(href) });
    }
  `,
  "next/navigation": `
    export const usePathname = () => window.location.pathname;
    export const useRouter = () => ({ push() {}, refresh() {}, replace() {} });
    export const unstable_rethrow = () => {};
  `,
};

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let buildDirectory = "";
let browserBundlePath = "";
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(
    join(tmpdir(), "account-layout-shell-browser-")
  );
  const build = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "account-layout-shell.browser-harness.tsx"),
    ],
    format: "iife",
    minify: true,
    naming: "account-layout-shell-harness.js",
    outdir: buildDirectory,
    plugins: [browserModuleStubPlugin(nextModuleStubs)],
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  browserBundlePath = join(buildDirectory, "account-layout-shell-harness.js");

  appStyles = await compileWorkspaceAppStyles();

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory)
    await rm(buildDirectory, { force: true, recursive: true });
});

/** The title the page's metadata gives the account page at a path. */
const pageTitleOfPath = (locale: Locale, pathname: string) => {
  if (pathname === getAccountPath(locale)) return getAccountPageTitle(locale);
  const section = pageSections.find(
    (candidate) => getAccountSectionPath(locale, candidate) === pathname
  );
  if (!section) throw new Error(`${pathname} is not an account page.`);
  return getAccountPageTitle(locale, section);
};

/**
 * Opens the shell as a document load of `pathname` would, with the title its
 * page metadata renders.
 */
const openAccountPage = async (
  page: Page,
  locale: Locale,
  pathname: string
) => {
  await page.goto(`${harnessOrigin}${pathname}`);
  await page.addStyleTag({ content: appStyles });
  await page.addScriptTag({ path: browserBundlePath });
  await page.locator(`[data-active-section]`).waitFor({ state: "attached" });
  // A document load clears the marker; an in-place switch keeps it.
  await page.evaluate(() => {
    document.documentElement.dataset.sameDocument = "";
  });
  expect(await page.title()).toBe(pageTitleOfPath(locale, pathname));
};

const newAccountPage = async (locale: Locale) => {
  if (!browser) throw new Error("The account browser has not launched.");
  const page = await browser.newPage({
    reducedMotion: "reduce",
    viewport: { height: 900, width: 1440 },
  });
  await page.route(`${harnessOrigin}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    return route.fulfill({
      body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${Bun.escapeHTML(pageTitleOfPath(locale, pathname))}</title></head><body><div id="account-layout-shell-test-root" data-locale="${locale}"></div></body></html>`,
      contentType: "text/html",
    });
  });
  return page;
};

const switchSection = async (
  page: Page,
  locale: Locale,
  section: AccountPageSection
) => {
  const sectionPath = getAccountSectionPath(locale, section);
  await page
    .locator(`nav a[href="${sectionPath}"]`)
    .filter({ visible: true })
    .click();
  await page.locator(`[data-active-section="${section}"]`).waitFor({
    state: "attached",
  });
  expect(new URL(page.url()).pathname).toBe(sectionPath);
  expect(
    await page.evaluate(
      () => document.documentElement.dataset.sameDocument !== undefined
    )
  ).toBe(true);
};

/** The title a reload of the current URL gives. */
const reloadedTitle = async (page: Page, locale: Locale) => {
  const pathname = new URL(page.url()).pathname;
  await openAccountPage(page, locale, pathname);
  return page.title();
};

for (const locale of locales) {
  test.skipIf(!chromiumAvailable)(
    `titles every ${locale} account section switched to in place as its reload does`,
    async () => {
      const page = await newAccountPage(locale);
      try {
        for (const from of pageSections) {
          await openAccountPage(
            page,
            locale,
            getAccountSectionPath(locale, from)
          );
          for (const to of pageSections.filter((section) => section !== from)) {
            await switchSection(page, locale, to);
            const switchedTitle = await page.title();

            expect(switchedTitle).toBe(getAccountPageTitle(locale, to));
            expect(await reloadedTitle(page, locale)).toBe(switchedTitle);
          }
        }
      } finally {
        await page.close();
      }
    }
  );

  test.skipIf(!chromiumAvailable)(
    `gives a ${locale} section switched to from the bare account path its own title`,
    async () => {
      const page = await newAccountPage(locale);
      try {
        await openAccountPage(page, locale, getAccountPath(locale));
        expect(await page.title()).toBe(getAccountPageTitle(locale));

        await switchSection(page, locale, "security");
        expect(await page.title()).toBe(
          getAccountPageTitle(locale, "security")
        );

        // Back on Reservations, the path names the section, so the title
        // does too, as a reload of that path shows.
        await switchSection(page, locale, "reservations");
        const reservationsTitle = await page.title();

        expect(reservationsTitle).toBe(
          getAccountPageTitle(locale, "reservations")
        );
        expect(reservationsTitle).not.toBe(getAccountPageTitle(locale));
        expect(await reloadedTitle(page, locale)).toBe(reservationsTitle);
      } finally {
        await page.close();
      }
    }
  );
}
