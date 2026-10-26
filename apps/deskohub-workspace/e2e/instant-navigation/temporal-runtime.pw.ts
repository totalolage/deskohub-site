import { expect, type Page, test } from "@playwright/test";
import { enablePreviewAccess } from "../preview-access";
import { waitForReactClickHandler } from "../react-handlers";
import { workspaceE2ETimeouts } from "../timeouts";

// The `<head>` loader requests this only where Temporal is missing or
// incomplete; see shared/polyfills/temporal-runtime.ts.
const polyfillPathname = "/polyfills/temporal.js";
const coworkPath = "/en-US/reservation/cowork";

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

/** Records polyfill requests, held back so the app's scripts arrive first. */
async function watchPolyfill(page: Page) {
  const requests: string[] = [];
  await page.route(
    (url) => url.pathname === polyfillPathname,
    async (route) => {
      requests.push(route.request().url());
      await new Promise((resolve) =>
        setTimeout(resolve, workspaceE2ETimeouts.temporalPolyfillResponseDelay)
      );
      await route.continue();
    }
  );
  return requests;
}

/**
 * Opens the cowork form and picks a day from its calendar, which runs the
 * form's Temporal date logic in the browser. Fails on any Temporal error the
 * page throws.
 */
async function pickCoworkDate(page: Page) {
  const temporalErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (String(error).includes("Temporal")) temporalErrors.push(String(error));
  });

  await page.goto(coworkPath);
  const calendarButton = page.getByRole("button", {
    name: "Reservation date: choose from the calendar",
  });
  await waitForReactClickHandler(page, calendarButton);
  await calendarButton.click();
  const calendar = page.getByRole("dialog", { name: "Reservation date" });
  await expect(calendar).toBeVisible();
  await calendar.locator("[data-day] button:enabled").last().click();
  await expect(calendar).toBeHidden();
  await expect(
    page.getByRole("combobox", { name: "Reservation date" })
  ).toHaveValue(/\d/);

  expect(temporalErrors).toEqual([]);
}

/** Whether the page's Temporal is the polyfill rather than the browser's own. */
const usesPolyfill = (page: Page) =>
  page.evaluate(
    () =>
      !Function.prototype.toString
        .call(Temporal.Now.instant)
        .includes("[native code]")
  );

test("serves the reservation form with this browser's Temporal", async ({
  browserName,
  page,
}) => {
  const polyfillRequests = await watchPolyfill(page);

  await pickCoworkDate(page);

  // Chromium ships a complete Temporal, so it downloads nothing.
  if (browserName === "chromium") {
    expect(polyfillRequests).toEqual([]);
    expect(await usesPolyfill(page)).toBe(false);
  } else {
    expect(polyfillRequests.length).toBe(Number(await usesPolyfill(page)));
  }
});

const forcedCases = [
  {
    name: "missing",
    removeTemporal: () => {
      Reflect.deleteProperty(globalThis, "Temporal");
    },
  },
  {
    name: "incomplete",
    removeTemporal: () => {
      const partial = { ...(globalThis as { Temporal?: object }).Temporal };
      Reflect.deleteProperty(partial, "PlainYearMonth");
      Object.defineProperty(globalThis, "Temporal", {
        configurable: true,
        writable: true,
        value: partial,
      });
    },
  },
] as const;

for (const { name, removeTemporal } of forcedCases) {
  test(`loads the polyfill before the app where Temporal is ${name}`, async ({
    page,
  }) => {
    await page.addInitScript(removeTemporal);
    const polyfillRequests = await watchPolyfill(page);

    await pickCoworkDate(page);

    expect(polyfillRequests).toHaveLength(1);
    expect(await usesPolyfill(page)).toBe(true);
  });
}
