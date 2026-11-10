import { expect } from "bun:test";
import type { Locator, Page } from "@playwright/test";
import type { Locale } from "@/features/i18n";
import { languageNames } from "@/features/i18n/language-labels";
import { readAxeViolations } from "@/shared/testing/axe-violations.test-utils";

// Czech first, then English, then the rest (owner decision D23).
const languageMenuOrder = [
  "cs-CZ",
  "en-US",
  "de-DE",
  "uk-UA",
  "sk-SK",
  "vi-VN",
  "hi-IN",
] as const satisfies readonly Locale[];

const waitForFocus = async (page: Page, target: Locator) => {
  const element = await target.elementHandle();
  await page.waitForFunction(
    (focused) => focused === document.activeElement,
    element
  );
};

type LanguageMenuExpectations = {
  readonly currentLocale: Locale;
  /** The address the item for another language opens. */
  readonly hrefFor: (locale: Locale) => string;
  /** The landmark around the trigger, which axe checks with the menu. */
  readonly region: string;
  readonly trigger: Locator;
  readonly triggerLabel: string;
};

/**
 * Opens the language menu from the keyboard, checks its items, focus
 * movement and links, and runs axe over the trigger's region with the menu
 * closed and open.
 */
export async function expectAccessibleLanguageMenu(
  page: Page,
  {
    currentLocale,
    hrefFor,
    region,
    trigger,
    triggerLabel,
  }: LanguageMenuExpectations
) {
  expect(await trigger.getAttribute("aria-label")).toBe(triggerLabel);
  expect(
    await page
      .getByRole("button", { exact: true, name: triggerLabel })
      .filter({ visible: true })
      .count()
  ).toBe(1);
  expect(await readAxeViolations(page, [region])).toEqual([]);

  const menu = page.getByRole("menu");
  const items = menu.getByRole("menuitem");

  // Enter opens the menu on its first item.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await menu.waitFor();
  expect(await trigger.getAttribute("aria-expanded")).toBe("true");
  await waitForFocus(page, items.first());
  expect(await items.allInnerTexts()).toEqual(
    languageMenuOrder.map((locale) => languageNames[locale])
  );

  expect(await menu.locator("[aria-current]").count()).toBe(1);
  const current = menu.locator('[role="menuitem"][aria-current="true"]');
  expect(await current.count()).toBe(1);
  expect(await current.innerText()).toBe(languageNames[currentLocale]);
  expect(await current.getAttribute("href")).toBeNull();
  for (const [index, locale] of languageMenuOrder.entries()) {
    if (locale === currentLocale) continue;
    const item = items.nth(index);
    expect(await item.getAttribute("aria-current")).toBeNull();
    expect(await item.evaluate((element) => element.tagName)).toBe("A");
    expect(await item.getAttribute("href")).toBe(hrefFor(locale));
    expect(await item.getAttribute("hreflang")).toBe(locale);
  }
  expect(
    await readAxeViolations(page, [region, "[data-locale-switcher]"])
  ).toEqual([]);

  // Escape closes it and gives focus back to the trigger.
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await waitForFocus(page, trigger);
  expect(await trigger.getAttribute("aria-expanded")).toBe("false");

  // ArrowDown opens it too, and the arrow keys move between the items.
  await page.keyboard.press("ArrowDown");
  await menu.waitFor();
  await waitForFocus(page, items.first());
  await page.keyboard.press("ArrowDown");
  await waitForFocus(page, items.nth(1));
  await page.keyboard.press("ArrowDown");
  await waitForFocus(page, items.nth(2));
  await page.keyboard.press("ArrowUp");
  await waitForFocus(page, items.nth(1));

  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await waitForFocus(page, trigger);
}
