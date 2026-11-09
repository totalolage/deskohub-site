import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { Skeleton } from "./skeleton";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  appStyles = await compileWorkspaceAppStyles();

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const readShimmer = async (reducedMotion: "no-preference" | "reduce") => {
  if (!browser) throw new Error("The Skeleton browser has not been launched.");
  const page = await browser.newPage({ reducedMotion });
  try {
    await page.setContent(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${renderToStaticMarkup(
        createElement(Skeleton, { className: "h-8 w-64" })
      )}</body></html>`
    );
    await page.addStyleTag({ content: appStyles });
    return await page.locator('[data-slot="skeleton"]').evaluate((element) => {
      const shimmer = getComputedStyle(element, "::after");
      return {
        animationName: shimmer.animationName,
        display: shimmer.display,
      };
    });
  } finally {
    await page.close();
  }
};

test.skipIf(!chromiumAvailable)(
  "animates the skeleton glimmer under normal motion",
  async () => {
    const shimmer = await readShimmer("no-preference");

    expect(shimmer.animationName).not.toBe("none");
    expect(shimmer.display).not.toBe("none");
  }
);

test.skipIf(!chromiumAvailable)(
  "hides the skeleton glimmer when the visitor prefers reduced motion",
  async () => {
    expect((await readShimmer("reduce")).display).toBe("none");
  }
);
