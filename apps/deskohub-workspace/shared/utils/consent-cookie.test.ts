import { describe, expect, test } from "bun:test";
import {
  getAcceptedConsentCategoriesFromCookie,
  getAcceptedConsentCategoriesFromCookieValue,
  type UnexpectedConsentCookieReason,
} from "./consent-cookie";

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

    const reasons: UnexpectedConsentCookieReason[] = [];

    expect(
      getAcceptedConsentCategoriesFromCookie(cookie, {
        onUnexpectedValue: (reason) => reasons.push(reason),
      })
    ).toEqual(["analytics"]);

    expect(reasons).toEqual(["unknown_category", "invalid_category_type"]);
  });

  test("warns when the consent cookie shape is unexpected", () => {
    const reasons: UnexpectedConsentCookieReason[] = [];

    expect(
      getAcceptedConsentCategoriesFromCookieValue("not-json", {
        onUnexpectedValue: (reason) => reasons.push(reason),
      })
    ).toEqual([]);
    expect(
      getAcceptedConsentCategoriesFromCookieValue(
        JSON.stringify({ categories: "analytics" }),
        { onUnexpectedValue: (reason) => reasons.push(reason) }
      )
    ).toEqual([]);

    expect(reasons).toEqual(["invalid_json", "invalid_categories_type"]);
  });
});
