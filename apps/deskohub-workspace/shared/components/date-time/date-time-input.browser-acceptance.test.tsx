import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import "@/shared/polyfills/temporal";
import { Input } from "@/shared/components/ui/input";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { DateTimeInput } from "./date-time-input";

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

// The meeting-room form lays the date and time side by side; the date column
// grows with its long-date description below the field. The plain time inputs
// show the same text with and without Chromium's own clock button.
const markup = renderToStaticMarkup(
  <main className="grid gap-4 p-4" style={{ width: 720 }}>
    <DateTimeInput
      className="grid-cols-2"
      dateLabel="Start date"
      locale="en-US"
      timeLabel="Start time"
      stepMinutes={60}
      value="2099-11-28T10:00"
    />
    {["with-button", "without-button"].map((plainTime) => (
      <div key={plainTime} style={{ width: 340 }}>
        <Input
          aria-label="Plain time"
          data-plain-time={plainTime}
          defaultValue="10:00"
          type="time"
        />
      </div>
    ))}
  </main>
);

// Counts the non-white pixels inside a time field, clear of its rounded border.
const countFieldInk = async (page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box.`);
  const shot = await page.screenshot({
    clip: {
      height: box.height - 16,
      width: box.width - 24,
      x: box.x + 12,
      y: box.y + 8,
    },
  });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas context.");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (Math.min(data[index], data[index + 1], data[index + 2]) < 200) ink++;
    }
    return ink;
  }, shot.toString("base64"));
};

test.skipIf(!chromiumAvailable)(
  "shows one clock, centered at the time field's trailing edge",
  async () => {
    if (!browser) throw new Error("The layout browser has not been launched.");
    const page = await browser.newPage({
      viewport: { height: 600, width: 800 },
    });
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${markup}</body></html>`
      );
      await page.addStyleTag({
        content: `${appStyles}*{transition:none!important}`,
      });

      const layout = await page.evaluate(() => {
        const dateInput =
          document.querySelector<HTMLInputElement>('[role="combobox"]');
        const timeInput =
          document.querySelector<HTMLInputElement>('input[type="time"]');
        const clock = timeInput?.parentElement?.querySelector("svg");
        if (!dateInput || !timeInput || !clock) return undefined;
        const dateBox = dateInput.getBoundingClientRect();
        const timeBox = timeInput.getBoundingClientRect();
        const clockBox = clock.getBoundingClientRect();
        const wrapperBox = timeInput.parentElement?.getBoundingClientRect();
        const timeStyle = getComputedStyle(timeInput);
        const textRight =
          timeBox.right -
          Number.parseFloat(timeStyle.borderRightWidth) -
          Number.parseFloat(timeStyle.paddingRight);
        return {
          clockCentered:
            Math.abs(
              clockBox.top +
                clockBox.height / 2 -
                (timeBox.top + timeBox.height / 2)
            ) < 0.5,
          clockHidden: clock.getAttribute("aria-hidden"),
          clockInsideField:
            clockBox.left >= timeBox.left && clockBox.right <= timeBox.right,
          clockAtTrailingEdge: timeBox.right - clockBox.right < 24,
          fieldsShareRow: Math.abs(dateBox.top - timeBox.top) < 0.5,
          textClearsClock: textRight <= clockBox.left + 0.5,
          wrapperFitsField:
            Math.abs((wrapperBox?.height ?? 0) - timeBox.height) < 0.5,
        };
      });

      expect(layout).toEqual({
        clockCentered: true,
        clockHidden: "true",
        clockInsideField: true,
        clockAtTrailingEdge: true,
        fieldsShareRow: true,
        textClearsClock: true,
        wrapperFitsField: true,
      });

      // The field draws its text and the orange clock. With the clock hidden,
      // it draws only its text: Chromium's clock button is there but
      // transparent.
      await page.addStyleTag({
        content:
          '[data-plain-time="without-button"]::-webkit-calendar-picker-indicator{display:none}',
      });
      const field = 'input[type="time"]:not([data-plain-time])';
      const textInk = await countFieldInk(
        page,
        '[data-plain-time="without-button"]'
      );
      expect(textInk).toBeGreaterThan(0);
      expect(
        await countFieldInk(page, '[data-plain-time="with-button"]')
      ).toBeGreaterThan(textInk);
      expect(await countFieldInk(page, field)).toBeGreaterThan(textInk);
      await page.evaluate((selector) => {
        const clock = document
          .querySelector(selector)
          ?.parentElement?.querySelector("svg");
        if (clock) clock.style.visibility = "hidden";
      }, field);
      expect(await countFieldInk(page, field)).toBe(textInk);
    } finally {
      await page.close();
    }
  }
);
