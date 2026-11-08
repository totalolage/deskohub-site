import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  getAcceptedConsentCategoriesFromCookie,
  isConsentCategoryAcceptedInCookie,
  readConsentCookieChoice,
  type UnexpectedConsentCookieReason,
} from "./consent-cookie";

// The banner revision current in these tests.
const revision = 7;
const current = { revision };

const cookieWithCategories = (...categories: readonly unknown[]) =>
  `cc_cookie=${encodeURIComponent(JSON.stringify({ categories, revision }))}`;

const readReasons = (cookie: string) => {
  const reasons: UnexpectedConsentCookieReason[] = [];
  const accepted = getAcceptedConsentCategoriesFromCookie(cookie, {
    revision,
    onUnexpectedValue: (reason) => reasons.push(reason),
  });
  return { accepted, reasons };
};

describe("getAcceptedConsentCategoriesFromCookie", () => {
  test("reads accepted categories from the CookieConsent cookie", () => {
    const cookie = `foo=bar; ${cookieWithCategories("analytics", "necessary")}`;

    expect(getAcceptedConsentCategoriesFromCookie(cookie, current)).toEqual([
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
    const categories = JSON.stringify({ categories: ["marketing"], revision });

    expect(
      getAcceptedConsentCategoriesFromCookie(`cc_cookie=${categories}`, current)
    ).toEqual(["marketing"]);
    expect(
      getAcceptedConsentCategoriesFromCookie(
        `cc_cookie=${encodeURIComponent(categories)}`,
        current
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

    expect(getAcceptedConsentCategoriesFromCookie(cookie, current)).toEqual([
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
    expect(isConsentCategoryAcceptedInCookie("", "analytics", current)).toBe(
      false
    );
  });

  test("checks whether the cookie accepts the requested category", () => {
    const cookie = cookieWithCategories("necessary", "analytics");

    expect(
      isConsentCategoryAcceptedInCookie(cookie, "analytics", current)
    ).toBe(true);
    expect(
      isConsentCategoryAcceptedInCookie(cookie, "marketing", current)
    ).toBe(false);
  });

  test("returns false for a copy saved under an earlier banner revision", () => {
    const cookie = `cc_cookie=${encodeURIComponent(
      JSON.stringify({ categories: ["necessary", "analytics"], revision: 0 })
    )}`;

    expect(
      isConsentCategoryAcceptedInCookie(cookie, "analytics", current)
    ).toBe(false);
  });

  test("returns false for malformed JSON", () => {
    const cookie = `cc_cookie=${encodeURIComponent("{")}`;

    expect(
      isConsentCategoryAcceptedInCookie(cookie, "analytics", current)
    ).toBe(false);
  });

  test("requires every copy of the consent cookie to accept the category", () => {
    const cookie = [
      cookieWithCategories("necessary", "analytics"),
      cookieWithCategories("necessary"),
    ].join("; ");

    expect(
      isConsentCategoryAcceptedInCookie(cookie, "analytics", current)
    ).toBe(false);
  });
});

describe("readConsentCookieChoice", () => {
  /** A saved copy as the banner writes it, with fields a test may break. */
  type SavedCookieValue = {
    readonly categories: readonly unknown[];
    readonly revision?: unknown;
    readonly consentTimestamp?: string;
    readonly lastConsentTimestamp?: unknown;
    readonly languageCode?: string;
  };

  const savedCookie = (value: SavedCookieValue) =>
    `cc_cookie=${encodeURIComponent(JSON.stringify({ revision, ...value }))}`;

  /** The choice as plain values, since instants compare by value only through `equals`. */
  const readChoice = (
    cookie: string,
    reasons: UnexpectedConsentCookieReason[] = []
  ) =>
    Option.getOrUndefined(
      Option.map(
        readConsentCookieChoice(cookie, {
          revision,
          onUnexpectedValue: (reason) => reasons.push(reason),
        }),
        (choice) => ({
          acceptedCategories: [...choice.acceptedCategories],
          lastConsentAt: Option.getOrUndefined(
            Option.map(choice.lastConsentAt, String)
          ),
          languageCode: Option.getOrUndefined(choice.languageCode),
        })
      )
    );

  test("reads the accepted categories and the last consent instant", () => {
    const cookie = savedCookie({
      categories: ["necessary", "analytics"],
      consentTimestamp: "2026-10-01T08:00:00.000Z",
      lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
      languageCode: "en-US",
    });

    expect(readChoice(cookie)).toEqual({
      acceptedCategories: ["necessary", "analytics"],
      lastConsentAt: "2026-11-02T09:30:00Z",
      languageCode: "en-US",
    });
  });

  test("reads a declining choice as a choice with its categories", () => {
    const cookie = savedCookie({
      categories: ["necessary"],
      lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
    });

    expect(readChoice(cookie)).toEqual({
      acceptedCategories: ["necessary"],
      lastConsentAt: "2026-11-02T09:30:00Z",
      languageCode: undefined,
    });
  });

  test("reads a cookie without a valid timestamp as undated", () => {
    for (const lastConsentTimestamp of [
      undefined,
      "yesterday",
      1_700_000_000,
    ]) {
      const cookie = savedCookie({
        categories: ["necessary", "analytics"],
        lastConsentTimestamp,
      });

      expect(readChoice(cookie)).toEqual({
        acceptedCategories: ["necessary", "analytics"],
        lastConsentAt: undefined,
        languageCode: undefined,
      });
    }
  });

  test("holds no choice without a consent cookie or with an emptied copy", () => {
    expect(readChoice("foo=bar")).toBeUndefined();
    expect(readChoice("cc_cookie=")).toBeUndefined();
    expect(
      readChoice(`cc_cookie=; ${cookieWithCategories("analytics")}`)
    ).toBeUndefined();
  });

  test("holds no choice, without a diagnostic, when a copy was saved under another banner revision or none", () => {
    const reasons: UnexpectedConsentCookieReason[] = [];
    const saved = {
      categories: ["necessary", "analytics"],
      lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
    };

    for (const staleRevision of [
      0,
      revision - 1,
      String(revision),
      undefined,
    ]) {
      expect(
        readChoice(savedCookie({ ...saved, revision: staleRevision }), reasons)
      ).toBeUndefined();
    }
    expect(
      readChoice(
        [savedCookie(saved), savedCookie({ ...saved, revision: 0 })].join("; "),
        reasons
      )
    ).toBeUndefined();
    expect(reasons).toEqual([]);
  });

  test("holds no choice when any copy is malformed and reports it", () => {
    const reasons: UnexpectedConsentCookieReason[] = [];
    const cookie = [
      savedCookie({
        categories: ["necessary", "analytics"],
        lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
      }),
      cookieWithCategories("analytics", "unknown"),
    ].join("; ");

    expect(readChoice(cookie, reasons)).toBeUndefined();
    expect(reasons).toEqual(["unknown_category"]);
  });

  test("reads several copies as the categories every copy accepts, dated at the oldest save", () => {
    const cookie = [
      savedCookie({
        categories: ["necessary", "analytics"],
        lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
      }),
      savedCookie({
        categories: ["necessary", "analytics", "marketing"],
        lastConsentTimestamp: "2026-11-01T09:30:00.000Z",
      }),
    ].join("; ");

    expect(readChoice(cookie)).toEqual({
      acceptedCategories: ["necessary", "analytics"],
      lastConsentAt: "2026-11-01T09:30:00Z",
      languageCode: undefined,
    });
  });

  test("reads the banner language only when every copy holds the same one", () => {
    const copy = (languageCode: string) =>
      savedCookie({ categories: ["necessary"], languageCode });

    expect(
      readChoice([copy("cs-CZ"), copy("cs-CZ")].join("; "))?.languageCode
    ).toBe("cs-CZ");
    expect(
      readChoice([copy("cs-CZ"), copy("en-US")].join("; "))?.languageCode
    ).toBeUndefined();
  });

  test("reads several copies as undated when any copy is undated", () => {
    const cookie = [
      savedCookie({
        categories: ["necessary", "analytics"],
        lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
      }),
      cookieWithCategories("necessary", "analytics"),
    ].join("; ");

    expect(readChoice(cookie)).toEqual({
      acceptedCategories: ["necessary", "analytics"],
      lastConsentAt: undefined,
      languageCode: undefined,
    });
  });
});
