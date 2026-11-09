import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import CookieSettingsPage from "./page";

const checkboxesIn = (html: string) =>
  [...html.matchAll(/<button[^>]*role="checkbox"[^>]*>/g)].map(([element]) => ({
    checked: element.includes('aria-checked="true"'),
    disabled: /\sdisabled(=""|\s|>)/.test(element),
  }));

describe("CookieSettingsPage", () => {
  test("starts with only necessary cookies on, and they cannot be turned off", () => {
    expect(checkboxesIn(renderToStaticMarkup(<CookieSettingsPage />))).toEqual([
      { checked: true, disabled: true },
      { checked: false, disabled: false },
      { checked: false, disabled: false },
      { checked: false, disabled: false },
    ]);
  });
});
