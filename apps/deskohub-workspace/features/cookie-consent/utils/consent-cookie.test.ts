import { describe, expect, test } from "bun:test";
import { getAcceptedConsentCategoriesFromCookie } from "./consent-cookie";

describe("getAcceptedConsentCategoriesFromCookie", () => {
  test("reads accepted categories from the CookieConsent cookie", () => {
    const cookie = `foo=bar; cc_cookie=${encodeURIComponent(
      JSON.stringify({ categories: ["analytics", "necessary"] })
    )}`;

    expect(getAcceptedConsentCategoriesFromCookie(cookie)).toEqual([
      "analytics",
      "necessary",
    ]);
  });

  test("ignores invalid or unknown values", () => {
    const cookie = `cc_cookie=${encodeURIComponent(
      JSON.stringify({ categories: ["analytics", "unknown", 1] })
    )}`;

    expect(getAcceptedConsentCategoriesFromCookie(cookie)).toEqual([
      "analytics",
    ]);
  });
});
