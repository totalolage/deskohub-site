import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type Browser,
  chromium,
  type Locator,
  type Page,
} from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

const screenshotDirectory = "/tmp/opencode";
const appDirectory = resolve(import.meta.dir, "../../..");
let browser: Browser | undefined;
let buildDirectory = "";
let browserBundlePath = "";
let appStyles = "";

beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
  buildDirectory = await mkdtemp(
    join(screenshotDirectory, "faq-browser-build-")
  );
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "faq-page.browser-harness.tsx")],
    format: "iife",
    minify: true,
    naming: "faq-page-harness.js",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  browserBundlePath = join(buildDirectory, "faq-page-harness.js");

  const sourceStylesPath = join(appDirectory, "app/globals.css");
  const sourceStyles = await readFile(sourceStylesPath, "utf8");
  appStyles = (
    await postcss([tailwindcss()]).process(sourceStyles, {
      from: sourceStylesPath,
    })
  ).css;

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory)
    await rm(buildDirectory, { force: true, recursive: true });
});

test("real browser keyboard and click interactions work at desktop and mobile widths", async () => {
  const desktop = await openFaqPage({ height: 1200, width: 1440 });
  const desktopSummaries = desktop.locator("summary");

  expect(await desktop.getByRole("heading", { level: 1 }).count()).toBe(1);
  expect(await desktop.getByRole("heading", { level: 1 }).textContent()).toBe(
    "Frequenty Asked Questions"
  );
  expect(await desktopSummaries.count()).toBe(6);
  await expectClosedDisclosures(desktop);

  await desktop.keyboard.press("Tab");
  const locationSummary = desktopSummaries.nth(0);
  expect(
    await locationSummary.evaluate(
      (element) => element === document.activeElement
    )
  ).toBe(true);
  expect(
    await locationSummary.evaluate((element) =>
      element.matches(":focus-visible")
    )
  ).toBe(true);
  expect(await locationSummary.getAttribute("class")).toContain(
    "focus-visible:ring-2"
  );
  await desktop.screenshot({
    fullPage: true,
    path: join(screenshotDirectory, "deskohub-faq-desktop-closed-focused.png"),
  });

  await desktop.keyboard.press("Enter");
  await expectDetailsOpen(locationSummary, true);
  expect(
    (await disclosureAccessibility(desktop, "Where are you located?")).expanded
  ).toBe(true);
  expect(await desktop.locator("address").textContent()).toBe(
    "Turnovská 430/10, Libeň, Praha 8 180 00"
  );
  await desktop.keyboard.press("Space");
  await expectDetailsOpen(locationSummary, false);

  const howItWorks = summaryForQuestion(desktop, "How does it work?");
  await howItWorks.focus();
  await desktop.keyboard.press("Enter");
  await expectDetailsOpen(howItWorks, true);
  await desktop.screenshot({
    fullPage: true,
    path: join(screenshotDirectory, "deskohub-faq-desktop-keyboard-open.png"),
  });
  await desktop.keyboard.press("Space");
  await expectDetailsOpen(howItWorks, false);

  const calls = summaryForQuestion(
    desktop,
    "Is there a space for taking calls?"
  );
  await howItWorks.click();
  await calls.click();
  await expectDetailsOpen(howItWorks, true);
  await expectDetailsOpen(calls, true);
  await desktop.screenshot({
    fullPage: true,
    path: join(screenshotDirectory, "deskohub-faq-desktop-multiple-open.png"),
  });
  await howItWorks.click();
  await expectDetailsOpen(howItWorks, false);
  await expectDetailsOpen(calls, true);
  await desktop.close();

  const mobile = await openFaqPage({ height: 1000, width: 390 });
  await expectClosedDisclosures(mobile);
  await mobile.screenshot({
    fullPage: true,
    path: join(screenshotDirectory, "deskohub-faq-mobile-closed.png"),
  });
  const mobileQuestion = summaryForQuestion(mobile, "How does it work?");
  await mobileQuestion.click();
  await expectDetailsOpen(mobileQuestion, true);
  await mobile.screenshot({
    fullPage: true,
    path: join(screenshotDirectory, "deskohub-faq-mobile-open.png"),
  });
  await mobile.close();
});

async function openFaqPage(viewport: {
  readonly height: number;
  readonly width: number;
}) {
  if (!browser) throw new Error("The FAQ browser has not been launched.");
  const page = await browser.newPage({
    reducedMotion: "reduce",
    viewport,
  });
  await page.setContent(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="faq-page-test-root"></div></body></html>'
  );
  await page.addStyleTag({ content: appStyles });
  await page.addScriptTag({ path: browserBundlePath });
  await page.getByRole("heading", { level: 1 }).waitFor();
  return page;
}

async function expectClosedDisclosures(page: Page) {
  const disclosures = page.locator("details");
  expect(await disclosures.count()).toBe(6);
  expect(await page.locator("summary").count()).toBe(6);
  expect(await page.getByRole("heading", { level: 2 }).count()).toBe(6);

  for (let index = 0; index < 6; index += 1) {
    const disclosure = disclosures.nth(index);
    expect(
      await disclosure.evaluate(
        (element) => element instanceof HTMLDetailsElement && element.open
      )
    ).toBe(false);
    expect(await disclosure.getAttribute("open")).toBeNull();
    const summary = disclosure.locator("summary");
    expect(await summary.getByRole("heading", { level: 2 }).count()).toBe(1);
    expect(await summary.evaluate((element) => element.tagName)).toBe(
      "SUMMARY"
    );
    expect(await summary.evaluate((element) => element.tabIndex)).toBe(0);
    const question = await summary.locator("h2").textContent();
    if (!question) throw new Error("FAQ summary is missing its question.");
    const accessibleSummary = await disclosureAccessibility(
      page,
      question.trim()
    );
    expect(accessibleSummary.role).toBe("DisclosureTriangle");
    expect(accessibleSummary.name).toBe(question.trim());
    expect(accessibleSummary.expanded).toBe(false);
    expect(accessibleSummary.focusable).toBe(true);
  }
}

async function disclosureAccessibility(page: Page, question: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const summary = nodes.find(
      (node) =>
        node.role?.value === "DisclosureTriangle" &&
        node.name?.value === question
    );
    if (!summary) {
      throw new Error(
        `No native disclosure accessibility node for ${question}.`
      );
    }
    return {
      expanded: summary.properties?.find(({ name }) => name === "expanded")
        ?.value?.value,
      focusable: summary.properties?.find(({ name }) => name === "focusable")
        ?.value?.value,
      name: summary.name?.value,
      role: summary.role?.value,
    };
  } finally {
    await session.detach();
  }
}

async function expectDetailsOpen(summary: Locator, open: boolean) {
  expect(
    await summary.evaluate((element) =>
      Boolean(element.closest("details")?.open)
    )
  ).toBe(open);
}

function summaryForQuestion(page: Page, question: string) {
  return page
    .getByRole("heading", { exact: true, level: 2, name: question })
    .locator("xpath=..");
}
