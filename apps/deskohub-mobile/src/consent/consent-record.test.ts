import { describe, expect, test } from "bun:test";
import { appLocales } from "../i18n/app-locale";
import { parseConsentRecord, serializeConsentRecord } from "./consent-record";

const decidedAt = "2026-11-07T10:00:00.000Z";

describe("parseConsentRecord", () => {
  test("reads no record as no answer", () => {
    expect(parseConsentRecord(null)).toEqual({ kind: "undecided" });
  });

  test("reads a record saved before the language was stored", () => {
    expect(
      parseConsentRecord(
        JSON.stringify({ categories: ["necessary", "analytics"], decidedAt })
      )
    ).toEqual({
      kind: "decided",
      categories: ["necessary", "analytics"],
      decidedAt,
    });
  });

  test("keeps an account's decision time exactly as stored", () => {
    for (const stored of [
      "2026-11-06T08:30:00.123Z",
      "2026-11-06T09:30:00+01:00",
      "2026-11-06T08:30:00.123456Z",
    ]) {
      expect(
        parseConsentRecord(
          JSON.stringify({
            categories: ["necessary"],
            decidedAt: stored,
            locale: "cs-CZ",
          })
        )
      ).toEqual({
        kind: "decided",
        categories: ["necessary"],
        decidedAt: stored,
        locale: "cs-CZ",
      });
    }
  });

  test("ignores a language the app doesn't support", () => {
    expect(
      parseConsentRecord(
        JSON.stringify({ categories: ["necessary"], decidedAt, locale: "de" })
      )
    ).toEqual({ kind: "decided", categories: ["necessary"], decidedAt });
  });

  test("reads a record with an unknown or invalid category as declined", () => {
    for (const categories of [
      ["analytics", "tracking"],
      ["analytics", 42],
    ]) {
      expect(
        parseConsentRecord(JSON.stringify({ categories, decidedAt }))
      ).toEqual({ kind: "decided", categories: [] });
    }
  });

  test("reads a record without a valid decision time as declined", () => {
    for (const record of [
      { categories: ["necessary", "analytics"] },
      { categories: ["necessary", "analytics"], decidedAt: "yesterday" },
      { categories: ["necessary", "analytics"], decidedAt: 1_762_509_600_000 },
      { categories: ["necessary", "analytics"], decidedAt: "2026-11-07" },
    ]) {
      expect(parseConsentRecord(JSON.stringify(record))).toEqual({
        kind: "decided",
        categories: [],
      });
    }
  });

  test("reads a malformed record as declined", () => {
    for (const raw of [
      "{",
      "null",
      '"analytics"',
      '{"categories":"analytics"}',
    ]) {
      expect(parseConsentRecord(raw)).toEqual({
        kind: "decided",
        categories: [],
      });
    }
  });

  test.each([...appLocales])(
    "round-trips a serialized answer made in %s",
    (locale) => {
      const raw = serializeConsentRecord({
        categories: ["necessary", "analytics"],
        decidedAt,
        locale,
      });
      expect(JSON.parse(raw)).toEqual({
        categories: ["necessary", "analytics"],
        decidedAt,
        locale,
      });
      expect(parseConsentRecord(raw)).toEqual({
        kind: "decided",
        categories: ["necessary", "analytics"],
        decidedAt,
        locale,
      });
    }
  );
});
