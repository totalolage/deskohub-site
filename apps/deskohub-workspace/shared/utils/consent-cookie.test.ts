import { describe, expect, test } from "bun:test";
import {
  getAcceptedConsentCategoriesFromCookie,
  isConsentCategoryAcceptedInCookie,
  type UnexpectedConsentCookieReason,
} from "./consent-cookie";

const cookieWithCategories = (...categories: readonly unknown[]) =>
  `cc_cookie=${encodeURIComponent(JSON.stringify({ categories }))}`;

const readReasons = (cookie: string) => {
  const reasons: UnexpectedConsentCookieReason[] = [];
  const accepted = getAcceptedConsentCategoriesFromCookie(cookie, {
    onUnexpectedValue: (reason) => reasons.push(reason),
  });
  return { accepted, reasons };
};

describe("getAcceptedConsentCategoriesFromCookie", () => {
  test("reads accepted categories from the CookieConsent cookie", () => {
    const cookie = `foo=bar; ${cookieWithCategories("analytics", "necessary")}`;

    expect(getAcceptedConsentCategoriesFromCookie(cookie)).toEqual([
      "necessary",
      "analytics",
    ]);
  });

  test("returns nothing without a consent cookie", () => {
    expect(readReasons("foo=bar")).toEqual({ accepted: [], reasons: [] });
  });

  test("treats an emptied copy as declining without a diagnostic", () => {
    expect(readReasons("cc_cookie=")).toEqual({ accepted: [], reasons: [] });
  });

  test("reads a copy with an invalid or unknown entry as declined", () => {
    expect(
      readReasons(cookieWithCategories("analytics", "unknown", 1))
    ).toEqual({
      accepted: [],
      reasons: ["unknown_category", "invalid_category_type"],
    });
  });

  test("reports an unexpected cookie shape", () => {
    expect(readReasons("cc_cookie=not-json")).toEqual({
      accepted: [],
      reasons: ["invalid_json"],
    });
    expect(
      readReasons(
        `cc_cookie=${encodeURIComponent(JSON.stringify({ categories: "analytics" }))}`
      )
    ).toEqual({ accepted: [], reasons: ["invalid_categories_type"] });
  });

  test("reads raw JSON values and URI-encoded JSON values", () => {
    const categories = JSON.stringify({ categories: ["marketing"] });

    expect(
      getAcceptedConsentCategoriesFromCookie(`cc_cookie=${categories}`)
    ).toEqual(["marketing"]);
    expect(
      getAcceptedConsentCategoriesFromCookie(
        `cc_cookie=${encodeURIComponent(categories)}`
      )
    ).toEqual(["marketing"]);
  });

  test("reports a JSON null value as an unexpected value type", () => {
    expect(readReasons("cc_cookie=null")).toEqual({
      accepted: [],
      reasons: ["invalid_value_type"],
    });
  });

  test("reports malformed URI encoding as invalid JSON", () => {
    expect(
      readReasons(`cc_cookie=${encodeURIComponent("%7B%E0%A4%A")}`)
    ).toEqual({ accepted: [], reasons: ["invalid_json"] });
  });

  test("keeps only the categories every copy accepts", () => {
    const cookie = [
      cookieWithCategories("necessary", "analytics", "marketing"),
      cookieWithCategories("necessary", "marketing"),
    ].join("; ");

    expect(getAcceptedConsentCategoriesFromCookie(cookie)).toEqual([
      "necessary",
      "marketing",
    ]);
  });

  test("reads every copy as declined when any copy is malformed", () => {
    const cookie = [
      cookieWithCategories("necessary", "analytics"),
      "cc_cookie=not-json",
    ].join("; ");

    expect(readReasons(cookie)).toEqual({
      accepted: [],
      reasons: ["invalid_json"],
    });
  });
});

describe("isConsentCategoryAcceptedInCookie", () => {
  test("returns false when there is no consent cookie", () => {
    expect(isConsentCategoryAcceptedInCookie("", "analytics")).toBe(false);
  });

  test("checks whether the cookie accepts the requested category", () => {
    const cookie = cookieWithCategories("necessary", "analytics");

    expect(isConsentCategoryAcceptedInCookie(cookie, "analytics")).toBe(true);
    expect(isConsentCategoryAcceptedInCookie(cookie, "marketing")).toBe(false);
  });

  test("returns false for malformed JSON", () => {
    const cookie = `cc_cookie=${encodeURIComponent("{")}`;

    expect(isConsentCategoryAcceptedInCookie(cookie, "analytics")).toBe(false);
  });

  test("requires every copy of the consent cookie to accept the category", () => {
    const cookie = [
      cookieWithCategories("necessary", "analytics"),
      cookieWithCategories("necessary"),
    ].join("; ");

    expect(isConsentCategoryAcceptedInCookie(cookie, "analytics")).toBe(false);
  });
});
