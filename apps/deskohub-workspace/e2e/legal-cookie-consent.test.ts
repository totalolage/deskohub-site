import { expect, test } from "bun:test";
import type { Page } from "@playwright/test";
import { m } from "@/features/i18n";
import {
  dismissLegalCookieConsent,
  hasReactClickHandler,
} from "./legal-cookie-consent";

const locale = "en-US" as const;
const analyticsCheckboxSelector = "#cookie-category-analytics";
const necessaryOnlyLabel = m.cookieConsentConsentModalAcceptNecessaryBtn(
  {},
  { locale }
);

type FakeLocator = {
  readonly _apiName: string;
  readonly _expect: (
    expression: string,
    options: Record<string, unknown>
  ) => Promise<{
    readonly matches: boolean;
    readonly received: { readonly value: boolean };
  }>;
  readonly click: (options?: { readonly timeout?: number }) => Promise<void>;
  readonly isVisible: () => Promise<boolean>;
};

type FakeConsentPage = {
  readonly clickCount: () => number;
  readonly evaluateArguments: readonly string[];
  readonly evaluateFunctions: readonly unknown[];
  readonly page: Page;
};

const makeFakeConsentPage = (input: {
  readonly analyticsVisible: boolean;
  readonly hydrationResults: readonly boolean[];
  readonly necessaryVisible: boolean;
}): FakeConsentPage => {
  let necessaryVisible = input.necessaryVisible;
  let evaluateIndex = 0;
  let clickCount = 0;
  const evaluateArguments: string[] = [];
  const evaluateFunctions: unknown[] = [];
  const getNecessaryVisibility = () => necessaryVisible;
  const getAnalyticsVisibility = () => input.analyticsVisible;

  const makeLocator = (isVisible: () => boolean): FakeLocator => ({
    _apiName: "Locator",
    _expect: async (expression) => {
      if (expression !== "to.be.hidden")
        throw new Error(`unexpected fake locator assertion: ${expression}`);
      const visible = isVisible();
      return {
        matches: !visible,
        received: { value: !visible },
      };
    },
    click: async () => {
      if (!isVisible()) throw new Error("fake cookie consent target is hidden");
      clickCount += 1;
      necessaryVisible = false;
    },
    isVisible: async () => isVisible(),
  });

  const necessaryOnlyButton = makeLocator(getNecessaryVisibility);
  const analyticsCheckbox = makeLocator(getAnalyticsVisibility);
  const page = Object.assign({} as Page, {
    evaluate: async (pageFunction: unknown, selector: string) => {
      evaluateFunctions.push(pageFunction);
      evaluateArguments.push(selector);
      const result =
        input.hydrationResults[
          Math.min(evaluateIndex, input.hydrationResults.length - 1)
        ];
      evaluateIndex += 1;
      return result ?? false;
    },
    getByRole: (_role: string, options: { readonly name?: string }) => {
      if (options.name !== necessaryOnlyLabel)
        throw new Error("fake cookie consent helper used the wrong locale");
      return necessaryOnlyButton;
    },
    locator: (selector: string) => {
      if (selector !== analyticsCheckboxSelector)
        throw new Error(`unexpected fake cookie consent selector: ${selector}`);
      return analyticsCheckbox;
    },
  });

  return {
    clickCount: () => clickCount,
    evaluateArguments,
    evaluateFunctions,
    page,
  };
};

test("clicks only the visible necessary-cookie action when the banner is present", async () => {
  const fake = makeFakeConsentPage({
    analyticsVisible: false,
    hydrationResults: [false],
    necessaryVisible: true,
  });

  await dismissLegalCookieConsent(fake.page, locale);

  expect(fake.clickCount()).toBe(1);
  expect(fake.evaluateArguments).toEqual([]);
});

test("waits for an inline analytics control when the consent banner is absent", async () => {
  const fake = makeFakeConsentPage({
    analyticsVisible: true,
    hydrationResults: [true],
    necessaryVisible: false,
  });

  await dismissLegalCookieConsent(fake.page, locale);

  expect(fake.clickCount()).toBe(0);
  expect(fake.evaluateArguments).toEqual([analyticsCheckboxSelector]);
  expect(fake.evaluateFunctions).toEqual([hasReactClickHandler]);
});

test("does not race a visible but unhydrated inline analytics control", async () => {
  const fake = makeFakeConsentPage({
    analyticsVisible: true,
    hydrationResults: [false, true],
    necessaryVisible: false,
  });

  await dismissLegalCookieConsent(fake.page, locale);

  expect(fake.clickCount()).toBe(0);
  expect(fake.evaluateArguments.length).toBeGreaterThanOrEqual(2);
  expect(fake.evaluateArguments).toEqual([
    analyticsCheckboxSelector,
    analyticsCheckboxSelector,
  ]);
  expect(fake.evaluateFunctions).toEqual([
    hasReactClickHandler,
    hasReactClickHandler,
  ]);
});

test("does not forge consent cookies or use timer delays", async () => {
  const source = await Bun.file(
    new URL("./legal-cookie-consent.ts", import.meta.url)
  ).text();

  expect(source).not.toMatch(
    /addCookies|document\.cookie|CookieConsent\.|acceptCategory|setTimeout|waitForTimeout/
  );
  expect(typeof hasReactClickHandler).toBe("function");
});
