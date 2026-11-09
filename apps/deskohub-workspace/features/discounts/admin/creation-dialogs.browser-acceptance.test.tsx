import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  type Browser,
  chromium,
  type Locator,
  type Page,
} from "@playwright/test";
import "@/shared/polyfills/temporal";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  buildDiscountDialogsBrowserPage,
  type DiscountDialog,
  type DiscountDialogsBrowserPage,
  discountDateFields,
  enterDate,
  openDiscountDialog,
} from "./creation-dialogs.browser-page.test-utils";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let harness: DiscountDialogsBrowserPage | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  harness = await buildDiscountDialogsBrowserPage();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  await harness?.dispose();
});

type Box = {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
};

const boxOf = async (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const { bottom, left, right, top } = element.getBoundingClientRect();
    return { bottom, left, right, top };
  });

/** Expects the element's content, such as a field's text, to fit its width. */
const expectContentFits = async (locator: Locator) => {
  const { clientWidth, scrollWidth } = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
};

const expectInside = (inner: Box, outer: Box) => {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - 0.5);
  expect(inner.right).toBeLessThanOrEqual(outer.right + 0.5);
};

/** Two fields share a row, the first left of the second, without overlap. */
const expectSideBySide = async (first: Locator, second: Locator) => {
  const [a, b] = await Promise.all([boxOf(first), boxOf(second)]);
  expect(Math.abs(a.top - b.top)).toBeLessThan(1);
  expect(a.right).toBeLessThanOrEqual(b.left);
  return [a, b] as const;
};

/** Fills every date field with the widest date the brand font sets. */
const fillDateFields = async (
  page: Page,
  dialog: DiscountDialog,
  locale: Locale
) => {
  const fields = discountDateFields(page, locale);
  await enterDate(fields.validFrom, "2028-08-08");
  await fields.validFromTime.fill("23:45");
  await enterDate(fields.validUntil, "2028-08-18");
  await fields.validUntilTime.fill("23:45");
  if (dialog === "code") {
    await enterDate(fields.serviceDateFrom, "2028-08-08");
    await enterDate(fields.serviceDateUntil, "2028-08-18");
  }
  return fields;
};

const scenarios = (["code", "voucher"] as const).flatMap((dialog) =>
  (["en-US", "cs-CZ"] as const).flatMap((locale) =>
    ([390, 768, 1280] as const).map((width) => ({ dialog, locale, width }))
  )
) satisfies readonly {
  readonly dialog: DiscountDialog;
  readonly locale: Locale;
  readonly width: number;
}[];

test.skipIf(!chromiumAvailable).each(scenarios)(
  "keeps the $dialog dialog's date pairs side by side inside it at $width px ($locale)",
  async ({ dialog, locale, width }) => {
    if (!browser || !harness) throw new Error("The browser is not ready.");
    const page = await browser.newPage({
      locale,
      viewport: { height: 900, width },
    });
    try {
      const dialogElement = await openDiscountDialog(page, harness, {
        dialog,
        locale,
      });
      const fields = await fillDateFields(page, dialog, locale);

      const dialogBox = await boxOf(dialogElement);
      const pairs: (readonly [Locator, Locator])[] = [
        [fields.validFrom, fields.validUntil],
        [fields.validFromTime, fields.validUntilTime],
      ];
      if (dialog === "code") {
        pairs.push([fields.serviceDateFrom, fields.serviceDateUntil]);
      }
      for (const [first, second] of pairs) {
        const [a, b] = await expectSideBySide(first, second);
        expectInside(a, dialogBox);
        expectInside(b, dialogBox);
      }

      if (dialog === "code") {
        const generate = dialogElement.getByRole("button", {
          name: m.discountsGenerateCode({}, { locale }),
        });
        const cell = generate.locator("xpath=..");
        expectInside(await boxOf(generate), await boxOf(cell));
        expectInside(await boxOf(cell), dialogBox);
        await expectContentFits(generate);
      }

      expect(
        await dialogElement.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
    } finally {
      await page.close();
    }
  }
);

/**
 * The date fields whose text, the typed date or else the format placeholder,
 * is wider than the room beside the calendar button.
 */
const findClippedDateText = async (
  fields: readonly Locator[],
  shown: "placeholder" | "value"
) => {
  const clipped: string[] = [];
  for (const field of fields) {
    const result = await field.evaluate((element, shownText) => {
      const input = element as HTMLInputElement;
      const style = getComputedStyle(input);
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("No 2D canvas context.");
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = shownText === "value" ? input.value : input.placeholder;
      // An empty text would fit trivially.
      if (text === "") return `no ${shownText}`;
      const needed = context.measureText(text).width;
      const room =
        input.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      return needed > room
        ? `${text}: ${Math.ceil(needed)} > ${Math.floor(room)}`
        : undefined;
    }, shown);
    if (result) clipped.push(result);
  }
  return clipped;
};

test.skipIf(!chromiumAvailable).each(scenarios)(
  "shows each date field's placeholder and typed date whole in the $dialog dialog at $width px ($locale)",
  async ({ dialog, locale, width }) => {
    if (!browser || !harness) throw new Error("The browser is not ready.");
    const page = await browser.newPage({
      locale,
      viewport: { height: 900, width },
    });
    try {
      await openDiscountDialog(page, harness, { dialog, locale });
      const empty = discountDateFields(page, locale);
      const dateFields = [empty.validFrom, empty.validUntil];
      if (dialog === "code") {
        dateFields.push(empty.serviceDateFrom, empty.serviceDateUntil);
      }
      const clipped = await findClippedDateText(dateFields, "placeholder");
      await fillDateFields(page, dialog, locale);
      clipped.push(...(await findClippedDateText(dateFields, "value")));
      expect(clipped).toEqual([]);
    } finally {
      await page.close();
    }
  }
);
