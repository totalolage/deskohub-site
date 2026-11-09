import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Locator } from "@playwright/test";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";

// The harness runs outside a Next.js app, so answer links render as plain
// anchors.
const nextModuleStubs: Readonly<Record<string, string>> = {
  "next/link": `
    import { createElement } from "react";
    export default function Link({ href, onNavigate: _onNavigate, prefetch: _prefetch, scroll: _scroll, ...props }) {
      return createElement("a", { ...props, href: String(href) });
    }
  `,
};

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let buildDirectory = "";
let browserBundlePath = "";
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;

  buildDirectory = await mkdtemp(join(tmpdir(), "faq-browser-build-"));
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "faq-page.browser-harness.tsx")],
    format: "iife",
    minify: true,
    naming: "faq-page-harness.js",
    outdir: buildDirectory,
    plugins: [browserModuleStubPlugin(nextModuleStubs)],
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  browserBundlePath = join(buildDirectory, "faq-page-harness.js");

  appStyles = await compileWorkspaceAppStyles();

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory)
    await rm(buildDirectory, { force: true, recursive: true });
});

test.skipIf(!chromiumAvailable)(
  "keyboard users see a focus ring and toggle FAQ disclosures with Enter and Space",
  async () => {
    if (!browser) throw new Error("The FAQ browser has not been launched.");
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { height: 1200, width: 1440 },
    });
    await page.setContent(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="faq-page-test-root"></div></body></html>'
    );
    await page.addStyleTag({ content: appStyles });
    await page.addScriptTag({ path: browserBundlePath });
    await page.getByRole("heading", { level: 1 }).waitFor();

    const summaries = page.locator("summary");
    const firstSummary = summaries.nth(0);
    await page.keyboard.press("Tab");
    expect(
      await firstSummary.evaluate(
        (element) =>
          element === document.activeElement &&
          element.matches(":focus-visible")
      )
    ).toBe(true);
    expect(
      await firstSummary.evaluate(
        (element) => getComputedStyle(element).boxShadow
      )
    ).not.toBe("none");

    await page.keyboard.press("Enter");
    await expectDetailsOpen(firstSummary, true);
    await page.keyboard.press("Space");
    await expectDetailsOpen(firstSummary, false);

    const secondSummary = summaries.nth(1);
    await secondSummary.focus();
    await page.keyboard.press("Space");
    await expectDetailsOpen(secondSummary, true);
    await page.keyboard.press("Enter");
    await expectDetailsOpen(secondSummary, false);
    await page.close();
  }
);

async function expectDetailsOpen(summary: Locator, open: boolean) {
  expect(
    await summary.evaluate((element) =>
      Boolean(element.closest("details")?.open)
    )
  ).toBe(open);
}
