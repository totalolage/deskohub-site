import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import "@/shared/polyfills/temporal";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { ReservationDatePicker } from "./reservation-date-picker";

// Layout and focus ring checks use the server markup; the calendar checks
// mount the client bundle from the browser harness.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let appStyles = "";
let buildDirectory = "";
let harnessBundlePath = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  appStyles = await compileWorkspaceAppStyles();
  buildDirectory = await mkdtemp(join(tmpdir(), "date-picker-browser-"));
  const build = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "reservation-date-picker.browser-harness.tsx"),
    ],
    format: "iife",
    // The calendar brings its stylesheet, so each output keeps its own name.
    naming: "[name].[ext]",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  harnessBundlePath =
    build.outputs.find(({ kind }) => kind === "entry-point")?.path ?? "";

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory)
    await rm(buildDirectory, { force: true, recursive: true });
});

// The office start date shares a two-column row at small widths, so its slot
// is the narrowest the field gets.
const slotWidths = [{ width: 260 }, { width: 340 }, { width: 560 }] as const;

const markup = renderToStaticMarkup(
  <main className="p-4">
    <span className="text-burned-orange" data-ring-reference>
      reference
    </span>
    <div data-slot-frame>
      <span id="start-label">Datum začátku rezervace kanceláře</span>
      <ReservationDatePicker
        ariaLabel="Datum začátku rezervace kanceláře"
        ariaLabelledBy="start-label"
        ariaRequired
        locale="cs-CZ"
        value="2099-11-28"
      />
    </div>
  </main>
);

test.skipIf(!chromiumAvailable)(
  "keeps the typed field beside its calendar button in every slot width",
  async () => {
    if (!browser) throw new Error("The layout browser has not been launched.");
    const page = await browser.newPage({
      viewport: { height: 600, width: 640 },
    });
    try {
      await page.setContent(
        `<!doctype html><html lang="cs"><head><meta charset="utf-8"></head><body>${markup}</body></html>`
      );
      await page.addStyleTag({
        content: `${appStyles}*{transition:none!important}`,
      });

      for (const { width } of slotWidths) {
        const layout = await page.evaluate((slotWidth) => {
          const frame =
            document.querySelector<HTMLElement>("[data-slot-frame]");
          const input =
            document.querySelector<HTMLInputElement>('[role="combobox"]');
          const button = document.querySelector(
            'button[aria-haspopup="dialog"]'
          );
          if (!frame || !input || !button) return undefined;
          frame.style.width = `${slotWidth}px`;
          const frameBox = frame.getBoundingClientRect();
          const inputBox = input.getBoundingClientRect();
          const buttonBox = button.getBoundingClientRect();
          return {
            buttonAfterInput: buttonBox.left >= inputBox.right,
            buttonHeight: buttonBox.height,
            buttonWidth: buttonBox.width,
            fitsSlot: buttonBox.right <= frameBox.right + 0.5,
            sameRow: Math.abs(buttonBox.top - inputBox.top) < 0.5,
            sameHeight: Math.abs(buttonBox.height - inputBox.height) < 0.5,
            textFits: input.scrollWidth <= input.clientWidth,
          };
        }, width);

        expect({ width, ...layout }).toEqual({
          width,
          buttonAfterInput: true,
          buttonHeight: expect.any(Number),
          buttonWidth: expect.any(Number),
          fitsSlot: true,
          sameRow: true,
          sameHeight: true,
          textFits: true,
        });
        expect(layout?.buttonHeight).toBeGreaterThanOrEqual(24);
        expect(layout?.buttonWidth).toBeGreaterThanOrEqual(24);
      }
    } finally {
      await page.close();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "Tab reaches the typed field, then its calendar button, each with the focus ring",
  async () => {
    if (!browser) throw new Error("The focus browser has not been launched.");
    const page = await browser.newPage();
    try {
      await page.setContent(
        `<!doctype html><html lang="cs"><head><meta charset="utf-8"></head><body>${markup}</body></html>`
      );
      await page.addStyleTag({
        content: `${appStyles}*{transition:none!important}`,
      });

      const readFocus = () =>
        page.evaluate(() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return undefined;
          const focused = getComputedStyle(active).boxShadow;
          // Blurring keeps the Tab position, so the next press moves on.
          active.blur();
          const reference = document.querySelector("[data-ring-reference]");
          return {
            name:
              active.getAttribute("aria-label") ??
              document.getElementById(
                active.getAttribute("aria-labelledby") ?? ""
              )?.textContent,
            showsRing:
              focused !== getComputedStyle(active).boxShadow &&
              focused.includes(
                reference ? getComputedStyle(reference).color : "-"
              ),
          };
        });

      await page.keyboard.press("Tab");
      expect(await readFocus()).toEqual({
        name: "Datum začátku rezervace kanceláře",
        showsRing: true,
      });
      await page.keyboard.press("Tab");
      expect(await readFocus()).toEqual({
        name: "Datum začátku rezervace kanceláře: vybrat v kalendáři",
        showsRing: true,
      });
    } finally {
      await page.close();
    }
  }
);

// The APG date picker combobox returns focus to the text field when Escape or
// a pick closes the calendar, so typing can continue where it left off.
test.skipIf(!chromiumAvailable)(
  "closing the calendar with Escape or a pick returns focus to the typed field",
  async () => {
    if (!browser) throw new Error("The calendar browser has not launched.");
    const page = await browser.newPage();
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="date-picker-test-root"></div></body></html>`
      );
      await page.addStyleTag({ content: appStyles });
      await page.addScriptTag({ path: harnessBundlePath });
      const field = page.getByRole("combobox", { name: "Reservation date" });
      const calendar = page.getByRole("dialog", { name: "Reservation date" });
      const calendarButton = page.getByRole("button", {
        name: "Reservation date: choose from the calendar",
      });
      const fieldFocused = () =>
        field.evaluate((element) => element === document.activeElement);

      await field.focus();
      await page.keyboard.press("ArrowDown");
      await calendar.waitFor();
      // The calendar focuses the selected day once it mounts.
      await page.waitForFunction(
        () =>
          document.activeElement
            ?.closest("[data-day]")
            ?.getAttribute("data-day") === "2099-06-10"
      );
      await page.keyboard.press("Escape");
      await calendar.waitFor({ state: "detached" });
      expect(await fieldFocused()).toBe(true);
      expect(await field.getAttribute("aria-expanded")).toBe("false");

      await page.keyboard.press("ArrowDown");
      await calendar.waitFor();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await calendar.waitFor({ state: "detached" });
      expect(await field.inputValue()).toBe("6/11/2099");
      expect(await fieldFocused()).toBe(true);

      await calendarButton.click();
      await calendar.waitFor();
      await page.locator('[data-day="2099-06-18"] button').click();
      await calendar.waitFor({ state: "detached" });
      expect(await field.inputValue()).toBe("6/18/2099");
      expect(await fieldFocused()).toBe(true);
    } finally {
      await page.close();
    }
  }
);
