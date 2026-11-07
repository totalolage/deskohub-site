import { describe, expect, test } from "bun:test";
import type { ConsentCategory, StoredConsent } from "./analytics-consent";
import { consentCookieAssignment, readConsentCookie } from "./consent-cookie";

const cookieWithCategories = (...categories: readonly unknown[]) =>
  `cc_cookie=${encodeURIComponent(JSON.stringify({ categories }))}`;

const declined: StoredConsent = { kind: "decided", categories: [] };

const decided = (...categories: readonly ConsentCategory[]): StoredConsent => ({
  kind: "decided",
  categories,
});

// Cases mirror apps/deskohub-workspace/shared/utils/consent-cookie.test.ts.
describe("readConsentCookie", () => {
  test("reads accepted categories from the CookieConsent cookie", () => {
    expect(
      readConsentCookie(
        `foo=bar; ${cookieWithCategories("analytics", "necessary")}`
      )
    ).toEqual(decided("necessary", "analytics"));
  });

  test("reads no consent cookie as no answer", () => {
    expect(readConsentCookie("foo=bar")).toEqual({ kind: "undecided" });
    expect(readConsentCookie("")).toEqual({ kind: "undecided" });
  });

  test("treats an emptied copy as declining", () => {
    expect(readConsentCookie("cc_cookie=")).toEqual(declined);
  });

  test("reads a copy with an invalid or unknown entry as declined", () => {
    expect(
      readConsentCookie(cookieWithCategories("analytics", "unknown"))
    ).toEqual(declined);
    expect(readConsentCookie(cookieWithCategories("analytics", 1))).toEqual(
      declined
    );
  });

  test("reads an unexpected cookie shape as declined", () => {
    for (const cookie of [
      "cc_cookie=not-json",
      "cc_cookie=null",
      `cc_cookie=${encodeURIComponent(JSON.stringify({ categories: "analytics" }))}`,
      `cc_cookie=${encodeURIComponent("%7B%E0%A4%A")}`,
    ]) {
      expect(readConsentCookie(cookie)).toEqual(declined);
    }
  });

  test("reads raw JSON values and URI-encoded JSON values", () => {
    const value = JSON.stringify({ categories: ["marketing"] });
    expect(readConsentCookie(`cc_cookie=${value}`)).toEqual(
      decided("marketing")
    );
    expect(readConsentCookie(`cc_cookie=${encodeURIComponent(value)}`)).toEqual(
      decided("marketing")
    );
  });

  test("keeps only the categories every copy accepts", () => {
    const cookie = [
      cookieWithCategories("necessary", "analytics", "marketing"),
      cookieWithCategories("necessary", "marketing"),
    ].join("; ");
    expect(readConsentCookie(cookie)).toEqual(
      decided("necessary", "marketing")
    );
  });

  test("reads every copy as declined when any copy is malformed", () => {
    const cookie = [
      cookieWithCategories("necessary", "analytics"),
      "cc_cookie=not-json",
    ].join("; ");
    expect(readConsentCookie(cookie)).toEqual(declined);
  });
});

describe("consentCookieAssignment", () => {
  const now = new Date("2026-11-07T10:00:00.000Z");
  const assign = (
    cookieString: string,
    categories: readonly ("necessary" | "analytics" | "marketing")[],
    hostname = "workspace.deskohub.cz",
    secure = true
  ) =>
    consentCookieAssignment({
      cookieString,
      categories,
      now,
      hostname,
      secure,
      languageCode: "cs-CZ",
      createConsentId: () => "new-id",
    });
  const recordOf = (assignment: string) => {
    const [pair] = assignment.split("; ");
    return JSON.parse(
      decodeURIComponent(pair?.slice("cc_cookie=".length) ?? "")
    );
  };

  test("writes a record the site's banner accepts as saved", () => {
    const assignment = assign("", ["necessary", "analytics"]);
    expect(recordOf(assignment)).toEqual({
      categories: ["necessary", "analytics"],
      revision: 0,
      data: null,
      services: {},
      languageCode: "cs-CZ",
      consentId: "new-id",
      consentTimestamp: "2026-11-07T10:00:00.000Z",
      lastConsentTimestamp: "2026-11-07T10:00:00.000Z",
      expirationTime: Date.parse("2027-05-08T10:00:00.000Z"),
    });
    expect(readConsentCookie(assignment.split("; ")[0] ?? "")).toEqual(
      decided("necessary", "analytics")
    );
  });

  test("uses the library's cookie attributes", () => {
    expect(assign("", ["necessary"]).split("; ").slice(1)).toEqual([
      "expires=Sat, 08 May 2027 10:00:00 GMT",
      "Path=/",
      "SameSite=Lax",
      "Domain=workspace.deskohub.cz",
      "Secure",
    ]);
    expect(
      assign("", ["necessary"], "localhost", false).split("; ").slice(1)
    ).toEqual([
      "expires=Sat, 08 May 2027 10:00:00 GMT",
      "Path=/",
      "SameSite=Lax",
    ]);
  });

  test("keeps the earlier record's identity and other fields", () => {
    const earlier = `cc_cookie=${encodeURIComponent(
      JSON.stringify({
        categories: ["necessary", "analytics", "marketing"],
        revision: 0,
        data: { source: "site" },
        consentId: "site-id",
        consentTimestamp: "2026-01-01T00:00:00.000Z",
        services: { analytics: [] },
        languageCode: "en-US",
        lastConsentTimestamp: "2026-01-01T00:00:00.000Z",
        expirationTime: 1,
      })
    )}`;
    expect(recordOf(assign(earlier, ["necessary", "marketing"]))).toEqual({
      categories: ["necessary", "marketing"],
      revision: 0,
      data: { source: "site" },
      consentId: "site-id",
      consentTimestamp: "2026-01-01T00:00:00.000Z",
      services: { analytics: [] },
      languageCode: "en-US",
      lastConsentTimestamp: "2026-11-07T10:00:00.000Z",
      expirationTime: Date.parse("2027-05-08T10:00:00.000Z"),
    });
  });
});
