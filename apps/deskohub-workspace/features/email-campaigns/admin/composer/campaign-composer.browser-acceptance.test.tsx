import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import type { Locale } from "@/features/i18n";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";

const harnessOrigin = "http://campaign-composer.test";
const desktopViewport = { height: 1212, width: 1896 } as const;
const shortDesktopViewport = { height: 760, width: 1440 } as const;
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

const openCampaignComposer = async (
  viewport: { readonly height: number; readonly width: number },
  locale: Locale = "en-US"
) => {
  if (!browser)
    throw new Error("The CampaignComposer browser has not launched.");
  const page = await browser.newPage({
    reducedMotion: "reduce",
    viewport,
  });
  await page.route(`${harnessOrigin}/**`, (route) =>
    route.fulfill({
      body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="campaign-composer-test-root" data-locale="${locale}"></div></body></html>`,
      contentType: "text/html",
    })
  );
  await page.goto(`${harnessOrigin}/${locale}/admin/email-campaigns/new`);
  await page.addStyleTag({ content: appStyles });
  await page.addScriptTag({ path: browserBundlePath });
  await page
    .locator('button[form="campaign-composer"]')
    .waitFor({ state: "visible" });
  return page;
};

/**
 * Where the campaign actions and the preview's language controls sit after
 * scrolling halfway or all the way down, and which element is drawn on top of the language
 * controls' upper edge and centre.
 */
const measureStickyLayout = (page: Page, position: "middle" | "bottom") =>
  page.evaluate((scrollPosition) => {
    const scrollRange =
      document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({
      behavior: "instant",
      top: scrollPosition === "bottom" ? scrollRange : scrollRange / 2,
    });
    const button = document.querySelector('button[form="campaign-composer"]');
    const bar = button?.parentElement?.parentElement;
    const previewAside = document.querySelector("#main-content .grid > aside");
    const localeControls = previewAside?.querySelector("fieldset");
    if (!(button && bar && previewAside && localeControls)) {
      throw new Error("The campaign composer layout is incomplete.");
    }
    const controls = localeControls.getBoundingClientRect();
    const isDrawnOnTop = (x: number, y: number) =>
      localeControls.contains(document.elementFromPoint(x, y));
    const centreX = controls.left + controls.width / 2;
    return {
      buttonBottom: button.getBoundingClientRect().bottom,
      buttonTop: button.getBoundingClientRect().top,
      controlsBottom: controls.bottom,
      controlsCentreOnTop: isDrawnOnTop(
        centreX,
        controls.top + controls.height / 2
      ),
      controlsTop: controls.top,
      controlsUpperEdgeOnTop: isDrawnOnTop(centreX, controls.top + 1),
      previewPosition: getComputedStyle(previewAside).position,
      previewBottom: previewAside.getBoundingClientRect().bottom,
      previewTop: previewAside.getBoundingClientRect().top,
      scrollY: window.scrollY,
      toolbarBottom: bar.getBoundingClientRect().bottom,
      toolbarPosition: getComputedStyle(bar).position,
      toolbarTop: bar.getBoundingClientRect().top,
    };
  }, position);

for (const { locale, viewport } of [
  { locale: "cs-CZ", viewport: desktopViewport },
  { locale: "en-US", viewport: desktopViewport },
  { locale: "cs-CZ", viewport: shortDesktopViewport },
] as const) {
  test.skipIf(!chromiumAvailable)(
    `keeps campaign actions clear of the preview language controls while the ${locale} ${viewport.width}x${viewport.height} desktop page scrolls`,
    async () => {
      const page = await openCampaignComposer(viewport, locale);
      try {
        const scrollStates = [
          await measureStickyLayout(page, "middle"),
          await measureStickyLayout(page, "bottom"),
        ];
        const [scrolled, bottom] = scrollStates;
        expect(scrolled?.scrollY).toBeGreaterThan(0);
        expect(bottom?.scrollY).toBeGreaterThan(scrolled?.scrollY ?? Infinity);
        for (const layout of scrollStates) {
          expect(layout.toolbarPosition).toBe("sticky");
          expect(layout.toolbarTop).toBeGreaterThanOrEqual(64);
          expect(layout.toolbarTop).toBeLessThan(66);
          expect(layout.buttonTop).toBeGreaterThanOrEqual(layout.toolbarTop);
          expect(layout.buttonBottom).toBeLessThan(viewport.height);
          expect(layout.previewPosition).toBe("sticky");
          expect(layout.previewTop).toBeGreaterThanOrEqual(
            layout.toolbarBottom
          );
          expect(layout.controlsTop).toBeGreaterThanOrEqual(
            layout.toolbarBottom
          );
          expect(layout.previewBottom).toBeLessThanOrEqual(viewport.height);
          expect(layout.controlsUpperEdgeOnTop).toBe(true);
          expect(layout.controlsCentreOnTop).toBe(true);
        }
      } finally {
        await page.close();
      }
    }
  );
}

test.skipIf(!chromiumAvailable)(
  "lets the wrapped campaign toolbar scroll away with the mobile page",
  async () => {
    const page = await openCampaignComposer(mobileViewport);
    try {
      const measure = (scrollTop: number) =>
        page.evaluate((top) => {
          window.scrollTo({ behavior: "instant", top });
          const button = document.querySelector(
            'button[form="campaign-composer"]'
          );
          const bar = button?.parentElement?.parentElement;
          return {
            buttonBottom: button?.getBoundingClientRect().bottom,
            scrollY: window.scrollY,
            toolbarBottom: bar?.getBoundingClientRect().bottom,
            toolbarPosition: bar ? getComputedStyle(bar).position : undefined,
          };
        }, scrollTop);
      const top = await measure(0);
      expect(top.toolbarPosition).toBe("static");
      expect(top.buttonBottom).toBeLessThan(mobileViewport.height);
      const scrolled = await measure(700);
      expect(scrolled.scrollY).toBeGreaterThan(0);
      expect(scrolled.toolbarBottom).toBeLessThan(0);
    } finally {
      await page.close();
    }
  }
);
