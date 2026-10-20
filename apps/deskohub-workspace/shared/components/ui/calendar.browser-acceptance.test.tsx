import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { Calendar, getCalendarLocale } from "./calendar";

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

const selectedDay = new Date(2099, 10, 18, 12);

const markup = renderToStaticMarkup(
  <main>
    <span className="bg-burned-orange" data-fill-reference>
      reference
    </span>
    <Calendar
      defaultMonth={selectedDay}
      locale={getCalendarLocale("cs-CZ")}
      mode="single"
      selected={selectedDay}
    />
  </main>
);

test.skipIf(!chromiumAvailable)(
  "fills the selected day and names the month in the site locale",
  async () => {
    if (!browser)
      throw new Error("The calendar browser has not been launched.");
    const page = await browser.newPage();
    try {
      await page.setContent(
        `<!doctype html><html lang="cs"><head><meta charset="utf-8"></head><body>${markup}</body></html>`
      );
      await page.addStyleTag({
        content: `${appStyles}*{transition:none!important}`,
      });

      const styles = await page.evaluate(() => {
        const reference = document.querySelector("[data-fill-reference]");
        const selected = document.querySelector(
          '[data-day="2099-11-18"] button'
        );
        const other = document.querySelector('[data-day="2099-11-19"] button');
        if (!reference || !selected || !other) return undefined;
        return {
          fill: getComputedStyle(reference).backgroundColor,
          otherFill: getComputedStyle(other).backgroundColor,
          selectedColor: getComputedStyle(selected).color,
          selectedFill: getComputedStyle(selected).backgroundColor,
        };
      });

      expect(styles).toBeDefined();
      expect(styles?.selectedFill).toBe(styles?.fill);
      expect(styles?.selectedColor).toBe("rgb(255, 255, 255)");
      expect(styles?.otherFill).not.toBe(styles?.fill);
      await expect(
        page.getByRole("grid", { name: "listopad 2099" }).count()
      ).resolves.toBe(1);
    } finally {
      await page.close();
    }
  }
);
