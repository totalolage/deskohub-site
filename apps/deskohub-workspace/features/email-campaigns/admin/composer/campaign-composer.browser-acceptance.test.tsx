import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";

const harnessOrigin = "http://campaign-composer.test";
const desktopViewport = { height: 1212, width: 1896 } as const;
const mobileViewport = { height: 844, width: 390 } as const;

const nextModuleStubs: Readonly<Record<string, string>> = {
  "next/link": `
    import { createElement } from "react";
    export default function Link({ href, prefetch: _prefetch, ...props }) {
      return createElement("a", { ...props, href: String(href) });
    }
  `,
  "next/navigation": `
    export const usePathname = () => window.location.pathname;
    export const useRouter = () => ({ push() {}, refresh() {} });
    export const useSearchParams = () => new URLSearchParams(window.location.search);
    export const unstable_rethrow = (error) => { throw error; };
  `,
  "../use-campaign-operation": `
    export function useCampaignOperation() {
      return { execute() {}, isExecuting: false };
    }
  `,
  "../editor/campaign-body-editor": `
    import { createElement } from "react";
    export function CampaignBodyEditor({ id, label }) {
      return createElement("div", {
        id,
        "aria-label": label,
        className: "min-h-80",
        role: "textbox",
      });
    }
  `,
  "../sending/campaign-send-controls": `
    export function CampaignSendControls() { return null; }
  `,
  "./delete-campaign-draft-control": `
    export function DeleteCampaignDraftControl() { return null; }
  `,
  "./campaign-email-preview": `
    import { createElement } from "react";
    export function CampaignEmailPreview() {
      return createElement("div", { "aria-label": "Campaign preview", className: "h-[30rem]" });
    }
  `,
  "@deskohub/secret-comparison": `
    export const isMatchingSecret = () => false;
  `,
};

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let buildDirectory = "";
let browserBundlePath = "";
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "campaign-composer-browser-"));
  const build = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "campaign-composer.browser-harness.tsx"),
    ],
    format: "iife",
    minify: true,
    naming: "campaign-composer-harness.js",
    outdir: buildDirectory,
    plugins: [browserModuleStubPlugin(nextModuleStubs)],
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  browserBundlePath = join(buildDirectory, "campaign-composer-harness.js");
  appStyles = await compileWorkspaceAppStyles();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory) {
    await rm(buildDirectory, { force: true, recursive: true });
  }
});

const openCampaignComposer = async (viewport: {
  readonly height: number;
  readonly width: number;
}) => {
  if (!browser)
    throw new Error("The CampaignComposer browser has not launched.");
  const page = await browser.newPage({
    reducedMotion: "reduce",
    viewport,
  });
  await page.route(`${harnessOrigin}/**`, (route) =>
    route.fulfill({
      body: `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="campaign-composer-test-root" data-locale="en-US"></div></body></html>`,
      contentType: "text/html",
    })
  );
  await page.goto(`${harnessOrigin}/en-US/admin/email-campaigns/new`);
  await page.addStyleTag({ content: appStyles });
  await page.addScriptTag({ path: browserBundlePath });
  await page
    .locator('button[form="campaign-composer"]')
    .waitFor({ state: "visible" });
  return page;
};

test.skipIf(!chromiumAvailable)(
  "keeps campaign actions and preview separate while the desktop page scrolls",
  async () => {
    const page = await openCampaignComposer(desktopViewport);
    try {
      const action = page.locator('button[form="campaign-composer"]');
      const toolbar = action.locator("xpath=../..");
      const preview = page.locator("#main-content .grid > aside");
      await page.evaluate(() =>
        window.scrollTo({ behavior: "instant", top: 700 })
      );
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(0);
      const layout = await page.evaluate(() => {
        const button = document.querySelector(
          'button[form="campaign-composer"]'
        );
        const bar = button?.parentElement?.parentElement;
        const previewAside = document.querySelector(
          "#main-content .grid > aside"
        );
        return {
          previewPosition: previewAside
            ? getComputedStyle(previewAside).position
            : undefined,
          previewTop: previewAside?.getBoundingClientRect().top,
          buttonBottom: button?.getBoundingClientRect().bottom,
          toolbarBottom: bar?.getBoundingClientRect().bottom,
          toolbarPosition: bar ? getComputedStyle(bar).position : undefined,
          toolbarTop: bar?.getBoundingClientRect().top,
        };
      });
      await action.waitFor({ state: "visible" });
      await toolbar.waitFor({ state: "visible" });
      await preview.waitFor({ state: "visible" });
      expect(layout.buttonBottom).toBeLessThan(desktopViewport.height);
      expect(layout.toolbarPosition).toBe("sticky");
      expect(layout.toolbarTop).toBeGreaterThanOrEqual(64);
      expect(layout.toolbarTop).toBeLessThan(66);
      expect(layout.previewPosition).toBe("sticky");
      expect(layout.previewTop).toBeGreaterThanOrEqual(
        layout.toolbarBottom ?? Infinity
      );
    } finally {
      await page.close();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "keeps the campaign create action in view while the mobile page scrolls",
  async () => {
    const page = await openCampaignComposer(mobileViewport);
    try {
      const action = page.locator('button[form="campaign-composer"]');
      const toolbar = action.locator("xpath=../..");
      await page.evaluate(() =>
        window.scrollTo({ behavior: "instant", top: 700 })
      );
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(0);
      const layout = await page.evaluate(() => {
        const button = document.querySelector(
          'button[form="campaign-composer"]'
        );
        const bar = button?.parentElement?.parentElement;
        return {
          buttonBottom: button?.getBoundingClientRect().bottom,
          toolbarPosition: bar ? getComputedStyle(bar).position : undefined,
          toolbarTop: bar?.getBoundingClientRect().top,
        };
      });
      await action.waitFor({ state: "visible" });
      await toolbar.waitFor({ state: "visible" });
      expect(layout.toolbarPosition).toBe("sticky");
      expect(layout.toolbarTop).toBeGreaterThanOrEqual(64);
      expect(layout.toolbarTop).toBeLessThan(66);
      expect(layout.buttonBottom).toBeLessThan(mobileViewport.height);
    } finally {
      await page.close();
    }
  }
);
