import "../../shared/polyfills/temporal";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium, type Page } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { evalBrowserScript } from "../browser";
import { toReservationSelectionPreparation } from "../browser-scripts";
import { browserSessionFor, makePlaywrightBrowserRunner } from "../runtime";
import {
  type CoworkAdvertisedPriceSelection,
  prepareCoworkAdvertisedPrice,
  toCoworkAdvertisedPriceSelection,
} from "./cowork-advertised-price";
import { makeCoworkCheckoutData } from "./data";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
});

const origin = "https://workspace.example.test";

const reservedDeskData = makeCoworkCheckoutData(
  origin,
  "2099-09-01",
  "calendar-pricing-change",
  { entryTier: "reserved-desk", monitorOption: "2x27-qhd" }
);

/** Shows `html` and runs the preparation on it in the page. */
const prepareOn = async (
  html: string,
  selection: CoworkAdvertisedPriceSelection
) => {
  if (!page) throw new Error("Chromium is not running");
  await page.setContent(html);
  return page.evaluate(prepareCoworkAdvertisedPrice, selection);
};

const readPage = <A>(read: (page: Page) => Promise<A>) => {
  if (!page) throw new Error("Chromium is not running");
  return read(page);
};

test.skipIf(!chromiumAvailable)(
  "prepares the Reserved Desk advertised price without requiring another tier",
  async () => {
    // Choosing the tier takes the price back to pending; choosing the
    // monitor makes it ready.
    const html = `
      <input name="date" value="2099-09-01" />
      <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="false"></button>
      <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
      <label id="monitor"><input type="radio" value="2x27-qhd" /></label>
      <script>{
        const price = document.querySelector('[data-reservation-type-price="reserved-desk"]');
        const tier = document.querySelector("#reservation-entry-tier-reserved-desk");
        const monitor = document.querySelector('input[value="2x27-qhd"]');
        price.addEventListener("click", () => {
          tier.checked = true;
          monitor.checked = false;
          price.dataset.reservationTypePriceReady = "false";
        });
        document.querySelector("#monitor").addEventListener("click", (event) => {
          event.preventDefault();
          monitor.checked = true;
          price.dataset.reservationTypePriceReady = "true";
        });
      }</script>`;

    expect(
      await prepareOn(html, toCoworkAdvertisedPriceSelection(reservedDeskData))
    ).toBe("about:blank");
    expect(
      await readPage((page) =>
        page.evaluate(() => ({
          monitor: document.querySelector<HTMLInputElement>(
            'input[value="2x27-qhd"]'
          )?.checked,
          ready: document.querySelector<HTMLElement>(
            '[data-reservation-type-price="reserved-desk"]'
          )?.dataset.reservationTypePriceReady,
          tier: document.querySelector<HTMLInputElement>(
            "#reservation-entry-tier-reserved-desk"
          )?.checked,
        }))
      )
    ).toEqual({ monitor: true, ready: "true", tier: true });
  }
);

test.skipIf(!chromiumAvailable)(
  "selects a monitor over a page-loaded Reserved Desk price",
  async () => {
    // The page renders both Reserved Desk variants priced, so choosing the
    // monitor never takes the price back to pending.
    const html = `
      <input name="date" value="2099-09-01" />
      <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="true"></button>
      <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
      <label><input type="radio" value="2x27-qhd" /></label>`;

    await prepareOn(html, toCoworkAdvertisedPriceSelection(reservedDeskData));
    expect(
      await readPage((page) => page.isChecked('input[value="2x27-qhd"]'))
    ).toBe(true);
  }
);

test.skipIf(!chromiumAvailable)(
  "turns the workstation on before choosing a monitor",
  async () => {
    // Monitor options render only after the workstation switch is on.
    const html = `
      <input name="date" value="2099-09-01" />
      <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="true"></button>
      <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
      <div data-cowork-optional-addon-toggle="workstation">
        <button role="switch" aria-checked="false"></button>
      </div>
      <script>{
        const workstation = document.querySelector('[role="switch"]');
        workstation.addEventListener("click", () => {
          workstation.setAttribute("aria-checked", "true");
          document.body.insertAdjacentHTML(
            "beforeend",
            '<label><input type="radio" value="2x27-qhd" checked /></label>' +
              '<label><input type="radio" value="2x32-qhd" /></label>'
          );
        });
      }</script>`;

    await prepareOn(
      html,
      toCoworkAdvertisedPriceSelection(
        makeCoworkCheckoutData(origin, "2099-09-01", "url-state-cowork", {
          entryTier: "reserved-desk",
          monitorOption: "2x32-qhd",
        })
      )
    );
    expect(
      await readPage(async (page) => ({
        monitor: await page.isChecked('input[value="2x32-qhd"]'),
        workstation: await page.getAttribute('[role="switch"]', "aria-checked"),
      }))
    ).toEqual({ monitor: true, workstation: "true" });
  }
);

test.skipIf(!chromiumAvailable)(
  "accepts an already-prepared prefilled Reserved Desk price",
  async () => {
    const html = `
      <input name="date" value="2099-09-01" />
      <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="true"></button>
      <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
      <label><input type="radio" value="2x27-qhd" checked /></label>`;

    expect(
      await prepareOn(html, toCoworkAdvertisedPriceSelection(reservedDeskData))
    ).toBe("about:blank");
  }
);

const editedDateHtml = (refreshesPrice: boolean) => `
  <button aria-haspopup="dialog" type="button"></button>
  <div data-day="2099-10-02"><button type="button"></button></div>
  <input name="date" value="2099-10-01" />
  <button data-reservation-type-price="open-space" data-reservation-type-price-ready="true"></button>
  <input id="reservation-entry-tier-open-space" type="radio" checked />
  <script>{
    const date = document.querySelector('input[name="date"]');
    const price = document.querySelector('[data-reservation-type-price="open-space"]');
    document.querySelector('[data-day="2099-10-02"] button').addEventListener("click", () => {
      date.value = "2099-10-02";
      if (!${refreshesPrice}) return;
      price.dataset.reservationTypePriceReady = "false";
      setTimeout(() => {
        price.dataset.reservationTypePriceReady = "true";
      }, 50);
    });
  }</script>`;

const editedDateData = makeCoworkCheckoutData(
  origin,
  "2099-10-02",
  "cowork-reservation-replacement"
);

test.skipIf(!chromiumAvailable)(
  "selects an edited cowork date and waits for its advertised price",
  async () => {
    await prepareOn(
      editedDateHtml(true),
      toCoworkAdvertisedPriceSelection(editedDateData)
    );
    expect(
      await readPage(async (page) => ({
        date: await page.inputValue('input[name="date"]'),
        ready: await page.getAttribute(
          '[data-reservation-type-price="open-space"]',
          "data-reservation-type-price-ready"
        ),
      }))
    ).toEqual({ date: "2099-10-02", ready: "true" });
  }
);

test.skipIf(!chromiumAvailable)(
  "fails with its own error once a wait runs out",
  async () => {
    // A new date whose price never goes pending again is not refreshed.
    await expect(
      prepareOn(editedDateHtml(false), {
        ...toCoworkAdvertisedPriceSelection(editedDateData),
        waitTimeoutMs: 600,
      })
    ).rejects.toThrow("advertised price did not refresh after date selection");
  }
);

test("rejects data for another product", () => {
  expect(() =>
    toCoworkAdvertisedPriceSelection({
      ...reservedDeskData,
      expectedReservationDetails: {
        kind: "office",
      } as never,
    })
  ).toThrow("Cowork reservation submission requires cowork data");
});

test.skipIf(!chromiumAvailable)(
  "runs the same preparation as the argv script the payment flow sends",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
    const id = `cowork-advertised-price-${randomUUID()}`;
    try {
      const output = await Effect.runPromise(
        Effect.gen(function* () {
          const session = yield* browserSessionFor(run, id);
          yield* session.use("show the page", (argvPage) =>
            argvPage.setContent(editedDateHtml(true))
          );
          const result = yield* evalBrowserScript(
            "prepare advertised price",
            run,
            id,
            toReservationSelectionPreparation(editedDateData),
            { timeoutMs: 10_000 }
          );
          const date = yield* session.use("read date", (argvPage) =>
            argvPage.inputValue('input[name="date"]')
          );
          return { date, exitCode: result.exitCode };
        })
      );
      expect(output).toEqual({ date: "2099-10-02", exitCode: 0 });
    } finally {
      await run.close?.();
    }
  }
);
