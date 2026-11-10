import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import "@/shared/polyfills/temporal";
import { m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { DateInput } from "./date-input";

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
    entrypoints: [join(import.meta.dir, "date-input.browser-harness.tsx")],
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
      <DateInput
        label="Datum začátku rezervace kanceláře"
        aria-labelledby="start-label"
        required
        locale="cs-CZ"
        value="2099-11-28"
      />
    </div>
  </main>
);

test.skipIf(!chromiumAvailable)(
  "keeps the calendar button inside the typed field's trailing edge in every slot width",
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
          const inputStyle = getComputedStyle(input);
          const textRight =
            inputBox.right -
            Number.parseFloat(inputStyle.borderRightWidth) -
            Number.parseFloat(inputStyle.paddingRight);
          return {
            buttonHeight: buttonBox.height,
            buttonWidth: buttonBox.width,
            centered:
              Math.abs(
                buttonBox.top +
                  buttonBox.height / 2 -
                  (inputBox.top + inputBox.height / 2)
              ) < 0.5,
            fieldFillsSlot: Math.abs(inputBox.width - frameBox.width) < 0.5,
            insideField:
              buttonBox.left >= inputBox.left &&
              buttonBox.right <= inputBox.right &&
              buttonBox.top >= inputBox.top &&
              buttonBox.bottom <= inputBox.bottom,
            atTrailingEdge: inputBox.right - buttonBox.right < 8,
            textClearsButton: textRight <= buttonBox.left + 0.5,
            textFits: input.scrollWidth <= input.clientWidth,
          };
        }, width);

        expect({ width, ...layout }).toEqual({
          width,
          buttonHeight: expect.any(Number),
          buttonWidth: expect.any(Number),
          centered: true,
          fieldFillsSlot: true,
          insideField: true,
          atTrailingEdge: true,
          textClearsButton: true,
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
        name: m.dateInputCalendarButtonLabel(
          { field: "Datum začátku rezervace kanceláře" },
          { locale: "cs-CZ" }
        ),
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
        name: m.dateInputCalendarButtonLabel(
          { field: "Reservation date" },
          { locale: "en-US" }
        ),
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

// Below 12rem the calendar button leaves the text's row, so a narrow cell
// shows a whole date and the format placeholder. The Czech placeholder is the
// widest the field shows.
const narrowCellWidths = [150, 180] as const;

const narrowMarkup = renderToStaticMarkup(
  <main className="p-4">
    {narrowCellWidths.map((width) => (
      <div key={width} data-narrow-cell={width} style={{ width }}>
        <DateInput
          label={`Datum v buňce ${width}`}
          locale="cs-CZ"
          value="2099-08-28"
        />
      </div>
    ))}
    {narrowCellWidths.map((width) => (
      <div key={width} data-empty-cell={width} style={{ width }}>
        <DateInput label={`Prázdné datum ${width}`} locale="cs-CZ" />
      </div>
    ))}
  </main>
);

test.skipIf(!chromiumAvailable)(
  "puts the calendar button on its own row below the whole text in a narrow cell",
  async () => {
    if (!browser) throw new Error("The layout browser has not been launched.");
    const page = await browser.newPage({
      viewport: { height: 900, width: 640 },
    });
    try {
      await page.setContent(
        `<!doctype html><html lang="cs"><head><meta charset="utf-8"></head><body>${narrowMarkup}</body></html>`
      );
      await page.addStyleTag({
        content: `${appStyles}*{transition:none!important}`,
      });
      const layouts = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            "[data-narrow-cell], [data-empty-cell]"
          ),
        ].map((cell) => {
          const input =
            cell.querySelector<HTMLInputElement>('[role="combobox"]');
          const button = cell.querySelector('button[aria-haspopup="dialog"]');
          if (!input || !button) return undefined;
          const cellBox = cell.getBoundingClientRect();
          const inputBox = input.getBoundingClientRect();
          const buttonBox = button.getBoundingClientRect();
          const style = getComputedStyle(input);
          const context = document.createElement("canvas").getContext("2d");
          if (!context) return undefined;
          context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const room =
            input.clientWidth -
            Number.parseFloat(style.paddingLeft) -
            Number.parseFloat(style.paddingRight);
          return {
            buttonBelowField: buttonBox.top >= inputBox.bottom,
            buttonSpansCell: Math.abs(buttonBox.width - cellBox.width) < 0.5,
            fieldFillsCell: Math.abs(inputBox.width - cellBox.width) < 0.5,
            textFits:
              context.measureText(input.value || input.placeholder).width <=
              room,
            buttonTallEnough: buttonBox.height >= 24,
            fontSize: style.fontSize,
          };
        })
      );
      expect(layouts).toHaveLength(narrowCellWidths.length * 2);
      for (const layout of layouts) {
        expect(layout).toEqual({
          buttonBelowField: true,
          buttonSpansCell: true,
          fieldFillsCell: true,
          textFits: true,
          buttonTallEnough: true,
          // Phones zoom into a field with smaller text.
          fontSize: "16px",
        });
      }
    } finally {
      await page.close();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "keeps focus order and calendar focus return in a narrow cell",
  async () => {
    if (!browser) throw new Error("The calendar browser has not launched.");
    // A phone viewport, where narrow cells occur.
    const page = await browser.newPage({
      viewport: { height: 844, width: 390 },
    });
    try {
      await page.setContent(
        `<!doctype html><html lang="cs"><head><meta charset="utf-8"></head><body><div id="date-picker-test-root"></div></body></html>`
      );
      await page.addStyleTag({ content: appStyles });
      await page.addScriptTag({ path: harnessBundlePath });
      const label = "Datum v úzké buňce";
      const field = page.getByRole("combobox", { name: label });
      const calendar = page.getByRole("dialog", { name: label });
      const calendarButton = page.getByRole("button", {
        name: m.dateInputCalendarButtonLabel(
          { field: label },
          { locale: "cs-CZ" }
        ),
      });
      const after = page.getByRole("button", { name: "Po úzké buňce" });
      const isFocused = (locator: typeof field) =>
        locator.evaluate((element) => element === document.activeElement);
      const fieldBox = await field.boundingBox();
      const buttonBox = await calendarButton.boundingBox();
      expect(
        buttonBox && fieldBox && buttonBox.y >= fieldBox.y + fieldBox.height
      ).toBe(true);

      // The text field, then its calendar button, then what follows.
      await field.focus();
      await page.keyboard.press("Tab");
      expect(await isFocused(calendarButton)).toBe(true);
      await page.keyboard.press("Tab");
      expect(await isFocused(after)).toBe(true);
      await page.keyboard.press("Shift+Tab");
      expect(await isFocused(calendarButton)).toBe(true);

      // The button opens the calendar next to its row, inside the viewport.
      await page.keyboard.press("Enter");
      await calendar.waitFor();
      const calendarBox = await calendar.boundingBox();
      const viewport = page.viewportSize();
      expect(
        calendarBox &&
          viewport &&
          calendarBox.x >= 0 &&
          calendarBox.x + calendarBox.width <= viewport.width &&
          calendarBox.y >= 0 &&
          calendarBox.y + calendarBox.height <= viewport.height
      ).toBe(true);
      await page.keyboard.press("Escape");
      await calendar.waitFor({ state: "detached" });
      expect(await isFocused(field)).toBe(true);

      await page.keyboard.press("ArrowDown");
      await calendar.waitFor();
      await page.keyboard.press("Enter");
      await calendar.waitFor({ state: "detached" });
      expect(await field.inputValue()).not.toBe("");
      expect(await isFocused(field)).toBe(true);
    } finally {
      await page.close();
    }
  }
);

// Enter in a field submits the form natively, without the field losing focus
// first. The controls still keep half a date-time, or text that is no date,
// out of a form that skips validation.
test.skipIf(!chromiumAvailable)(
  "Enter never submits a partial date-time or text that is no date",
  async () => {
    if (!browser) throw new Error("The form browser has not launched.");
    const page = await browser.newPage({ locale: "en-US" });
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="date-picker-test-root"></div></body></html>`
      );
      await page.addStyleTag({ content: appStyles });
      await page.addScriptTag({ path: harnessBundlePath });
      const form = page.locator("form").first();
      const submissions = async () =>
        JSON.parse((await form.getAttribute("data-submissions")) ?? "[]");
      const startsDate = page.getByRole("combobox", { name: "Starts" });
      const startsTime = page.getByLabel("Starts time");
      const serviceDate = page.getByRole("combobox", { name: "Service date" });
      const isFocused = (field: typeof startsDate) =>
        field.evaluate((element) => element === document.activeElement);

      await startsDate.fill("6/10/2099");
      await startsDate.press("Enter");
      expect(await submissions()).toEqual([]);
      expect(await isFocused(startsTime)).toBe(true);
      expect(await startsTime.getAttribute("aria-invalid")).toBe("true");

      // Segment by segment, as a person types into the time editor: hour,
      // minute, then the day period of the en-US editor.
      await startsTime.focus();
      await page.keyboard.type("0200P");
      await startsTime.press("Enter");
      expect(await submissions()).toEqual(["2099-06-10T14:00|"]);

      await serviceDate.fill("next friday");
      await serviceDate.press("Enter");
      expect(await submissions()).toHaveLength(1);
      expect(await isFocused(serviceDate)).toBe(true);
      expect(await serviceDate.getAttribute("aria-invalid")).toBe("true");

      await serviceDate.fill("6/12/2099");
      await serviceDate.press("Enter");
      expect(await submissions()).toEqual([
        "2099-06-10T14:00|",
        "2099-06-10T14:00|2099-06-12",
      ]);
    } finally {
      await page.close();
    }
  }
);

// Pressing a submit button takes focus from the time field before the form
// submits, so leaving the field must not swap a time the bounds leave out for
// the time before it.
test.skipIf(!chromiumAvailable)(
  "a submit button never submits the time before a typed time outside the bounds",
  async () => {
    if (!browser) throw new Error("The form browser has not launched.");
    const page = await browser.newPage({ locale: "en-US" });
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="date-picker-test-root"></div></body></html>`
      );
      await page.addStyleTag({ content: appStyles });
      await page.addScriptTag({ path: harnessBundlePath });
      const form = page.locator("form[data-bounded-form]");
      const submissions = async () =>
        JSON.parse((await form.getAttribute("data-submissions")) ?? "[]");
      const time = page.getByLabel("Evening start time");
      const submittedStart = form.locator('input[name="eveningStart"]');
      const book = page.getByRole("button", { name: "Book the evening" });

      // Hour, minute, then the day period of the en-US editor.
      for (const [typed, shown] of [
        ["0700A", "07:00"],
        ["0900P", "21:00"],
      ] as const) {
        await time.focus();
        await page.keyboard.type(typed);
        await book.click();

        expect({ typed, submissions: await submissions() }).toEqual({
          typed,
          submissions: [],
        });
        expect(await time.inputValue()).toBe(shown);
        expect(await submittedStart.inputValue()).toBe("");
        expect(await time.getAttribute("aria-invalid")).toBe("true");
        expect(
          await time.evaluate((element) => element === document.activeElement)
        ).toBe(true);
      }

      await time.focus();
      await page.keyboard.type("0600P");
      await book.click();
      expect(await submissions()).toEqual(["2099-06-10T18:00"]);
    } finally {
      await page.close();
    }
  }
);
