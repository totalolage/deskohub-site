import "@/shared/polyfills/temporal";

import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { Effect } from "effect";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  type BrowserStepDriver,
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import type { ExpectedDiscountApplication } from "../integrations/database";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  assertDisplayedDiscounts,
  calendarDiscountExpectation,
  findUnpayableSummaryProblem,
  isDiscountDetailShown,
  toDiscountDetail,
  waitForAdvertisedCalendarSale,
} from "./discounts";

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

const requirePage = () => {
  if (!page) throw new Error("Chromium is not running");
  return page;
};

const calendarAdjustment = formatDiscountAdjustment(
  calendarDiscountExpectation.adjustment,
  "en-US"
);

/**
 * The pay page's discount-details trigger and its tooltip. `handlers` are
 * the React props the trigger carries; `hidden` hides it.
 */
const discountDetails = ({
  detail = `${calendarDiscountExpectation.label.toUpperCase()} ${calendarAdjustment}`,
  handlers = ["onFocus"],
  hidden = false,
}: {
  readonly detail?: string;
  readonly handlers?: readonly string[];
  readonly hidden?: boolean;
} = {}) => `
  <button data-checkout-discount-details aria-describedby="discount-tip"${hidden ? " hidden" : ""}>Discounts</button>
  <div id="discount-tip" role="tooltip">${detail}</div>
  <script>{
    document.querySelector("[data-checkout-discount-details]").__reactProps$test =
      Object.fromEntries(${JSON.stringify(handlers)}.map((name) => [name, () => {}]));
  }</script>`;

test.skipIf(!chromiumAvailable)(
  "finds a discount in the details tooltip by label, ignoring case, and adjustment",
  async () => {
    const shownOn = async (html: string) => {
      await requirePage().setContent(html);
      return requirePage().evaluate(
        isDiscountDetailShown,
        toDiscountDetail(calendarDiscountExpectation)
      );
    };

    expect(await shownOn(discountDetails())).toBe(true);
    expect(
      await shownOn(
        discountDetails({ detail: calendarDiscountExpectation.label })
      )
    ).toBe(false);
    expect(
      await shownOn(
        discountDetails({ detail: `Other sale ${calendarAdjustment}` })
      )
    ).toBe(false);
    // Without its description the trigger names nothing.
    expect(
      await shownOn(
        discountDetails().replace('aria-describedby="discount-tip"', "")
      )
    ).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "keeps a pay page payable only with its consent and pay action",
  async () => {
    const problemOn = async (html: string) => {
      await requirePage().setContent(html);
      return requirePage().evaluate(findUnpayableSummaryProblem);
    };
    const consent = '<button id="checkout-pay-legal-consent">Consent</button>';
    const pay = "<button>Order and pay</button>";

    expect(await problemOn(consent + pay)).toBeNull();
    expect(
      await problemOn(
        '<button id="checkout-pay-legal-consent" disabled>Consent</button>' +
          pay
      )
    ).toBe("payment consent unavailable after code rejection");
    expect(await problemOn(consent)).toBe(
      "payment action unavailable after code rejection"
    );
  }
);

// Short bounds, so a timeout shows within the test.
const config = {
  timeouts: { ...workspaceE2ETimeouts, browserAction: 2000 },
} as WorkspaceE2EConfig;

/**
 * How a caller hands over the browser: argv callers pass the runner and the
 * session id, session callers (the referral cases) the session itself.
 */
const browserInputs = {
  session: ({ session }: BrowserStepDriver) => ({ session }),
} as const;

const assertCalendarDiscountOn = (
  html: string,
  input: (typeof browserInputs)[keyof typeof browserInputs],
  {
    discounts = [calendarDiscountExpectation],
    stepTimeoutMs,
  }: {
    readonly discounts?: readonly ExpectedDiscountApplication[];
    readonly stepTimeoutMs?: number;
  } = {}
) => {
  if (!browser) throw new Error("Chromium is not running");
  const output = spyOn(process.stdout, "write").mockImplementation(() => true);
  return runBrowserStep({
    browser,
    drive: (driver) =>
      assertDisplayedDiscounts({
        config,
        discounts,
        timeoutMs: 2000,
        ...input(driver),
      }),
    prepare: (session) =>
      session.use("show the pay page", (payPage) => payPage.setContent(html)),
    stepTimeoutMs,
  })
    .then((result) => ({
      ...result,
      logs: output.mock.calls.map(([chunk]) => String(chunk)),
    }))
    .finally(() => output.mockRestore());
};

for (const [caller, input] of Object.entries(browserInputs)) {
  test.skipIf(!chromiumAvailable)(
    `asserts a displayed discount through its tooltip (${caller})`,
    async () => {
      const result = await assertCalendarDiscountOn(discountDetails(), input);
      expect(result.succeeded).toBe(true);
      expect(result.annotations).toEqual([]);
      expect(
        result.logs.filter((line) => line.startsWith("DISCOUNT_WAIT"))
      ).toEqual([]);
    },
    60_000
  );

  // The Calendar sale advertisement retries only these timeouts.
  test.skipIf(!chromiumAvailable)(
    `times out a discount the tooltip never shows and a trigger never hydrated (${caller})`,
    async () => {
      for (const { html, stage, detailIndex } of [
        {
          html: discountDetails({ detail: "No discounts" }),
          stage: "detail",
          detailIndex: 1,
        },
        {
          html: discountDetails({
            detail: `${calendarDiscountExpectation.label} wrong adjustment`,
          }),
          stage: "detail",
          detailIndex: 1,
        },
        {
          html: discountDetails({ handlers: [] }),
          stage: "react-handler",
          detailIndex: 0,
        },
        // A hidden trigger scrolls but never takes focus.
        {
          html: discountDetails({ hidden: true }),
          stage: "blur-trigger",
          detailIndex: 0,
        },
      ]) {
        const result = await assertCalendarDiscountOn(html, input);
        expect(result.annotations).toEqual(failedStepAnnotation("timeout"));
        expect(result.failures.map(({ timeout }) => timeout)).toEqual([true]);
        expect(
          result.logs.filter((line) => line.startsWith("DISCOUNT_WAIT"))
        ).toEqual([
          `DISCOUNT_WAIT stage=${stage} detail_index=${detailIndex} detail_count=1\n`,
        ]);
      }
    },
    90_000
  );
}

test.skipIf(!chromiumAvailable)(
  "logs the pending detail before an outer step deadline interrupts the assertion",
  async () => {
    const result = await assertCalendarDiscountOn(
      discountDetails(),
      browserInputs.session,
      {
        discounts: [
          calendarDiscountExpectation,
          {
            adjustment: { kind: "percentage", basisPoints: 1000 },
            label: "Synthetic second discount",
          },
        ],
        stepTimeoutMs: 1000,
      }
    );

    expect(result.succeeded).toBe(false);
    expect(result.annotations).toEqual(failedStepAnnotation("timeout"));
    const diagnostic =
      "DISCOUNT_WAIT stage=detail detail_index=2 detail_count=2\n";
    expect(
      result.logs.filter((line) => line.startsWith("DISCOUNT_WAIT"))
    ).toEqual([diagnostic]);
    const terminalIndex = result.logs.findIndex((line) =>
      line.startsWith("STEP TIMEOUT")
    );
    expect(terminalIndex).toBeGreaterThan(result.logs.indexOf(diagnostic));
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "reopens dismissed discount details when the trigger is still focused",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const result = await runBrowserStep({
      browser,
      drive: ({ session }) =>
        assertDisplayedDiscounts({
          config,
          discounts: [calendarDiscountExpectation],
          session,
          timeoutMs: 2000,
        }),
      prepare: (session) =>
        session.use("dismiss the focused discount tooltip", async (payPage) => {
          await payPage.setContent(discountDetails());
          const trigger = payPage.locator("[data-checkout-discount-details]");
          await trigger.evaluate((element) => {
            element.addEventListener("focus", () =>
              element.setAttribute("aria-describedby", "discount-tip")
            );
            element.addEventListener("keydown", (event) => {
              if (event.key === "Escape") {
                element.removeAttribute("aria-describedby");
              }
            });
          });
          await trigger.focus();
          await payPage.keyboard.press("Escape");

          expect(
            await trigger.evaluate(
              (element) => document.activeElement === element
            )
          ).toBe(true);
          expect(
            await payPage.evaluate(
              isDiscountDetailShown,
              toDiscountDetail(calendarDiscountExpectation)
            )
          ).toBe(false);
        }),
    });

    expect(result.succeeded).toBe(true);
    expect(result.annotations).toEqual([]);
  },
  60_000
);

// The reservation form behind the Calendar sale advertisement: the selection
// is already made, and the sale shows from the `showFromLoad`th load on.
let formLoads = 0;
let showFromLoad = 1;
let formHtml = (_load: number) => "";
const formServer = Bun.serve({
  fetch: () => {
    formLoads += 1;
    return new Response(formHtml(formLoads), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
  port: 0,
});

afterAll(() => formServer.stop(true));

const preparedForm = (load: number) => `<!doctype html><body>
  <input name="date" value="2099-09-01" />
  <button data-reservation-type-price="open-space" data-reservation-type-price-ready="true"></button>
  <input id="reservation-entry-tier-open-space" type="radio" checked />
  ${discountDetails(load >= showFromLoad ? {} : { detail: "No discounts" })}
</body>`;

const advertiseCalendarSale = () => {
  if (!browser) throw new Error("Chromium is not running");
  formLoads = 0;
  return runBrowserStep({
    browser,
    drive: ({ id, run }) =>
      waitForAdvertisedCalendarSale({
        config: {
          timeouts: {
            ...workspaceE2ETimeouts,
            browserAction: 2000,
            calendarSaleAdvertisement: 20_000,
            calendarSaleAdvertisementAttempt: 1500,
          },
        } as WorkspaceE2EConfig,
        data: makeCoworkCheckoutData(
          formServer.url.origin,
          "2099-09-01",
          "calendar-sale-advertisement"
        ),
        run,
        session: id,
      }),
    prepare: () => Effect.void,
    stepTimeoutMs: 30_000,
  });
};

test.skipIf(!chromiumAvailable)(
  "loads the form again while the Calendar sale's detail times out",
  async () => {
    formHtml = preparedForm;
    showFromLoad = 2;
    const result = await advertiseCalendarSale();

    expect(result.succeeded).toBe(true);
    expect(formLoads).toBe(2);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "stops advertising the Calendar sale at a preparation failure",
  async () => {
    // No price control: the preparation fails, which is not retried.
    formHtml = () => '<!doctype html><body><input name="date" /></body>';
    const result = await advertiseCalendarSale();

    expect(result.annotations).toEqual(failedStepAnnotation("error"));
    expect(formLoads).toBe(1);
  },
  60_000
);
