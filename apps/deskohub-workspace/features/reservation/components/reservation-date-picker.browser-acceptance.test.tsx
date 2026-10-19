import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import "@/shared/polyfills/temporal";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { ReservationDatePicker } from "./reservation-date-picker";

// The calendar popover needs the client bundle, so this checks the server
// markup's layout and focus ring; the component test covers opening it.
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
