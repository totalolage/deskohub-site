import { describe, expect, test } from "bun:test";
import { parseConsentRecord, serializeConsentRecord } from "./consent-record";

describe("parseConsentRecord", () => {
  test("reads no record as no answer", () => {
    expect(parseConsentRecord(null)).toEqual({ kind: "undecided" });
  });

  test("reads a saved answer and ignores unknown categories", () => {
    expect(
      parseConsentRecord(
        JSON.stringify({ categories: ["necessary", "analytics", "tracking"] })
      )
    ).toEqual({ kind: "decided", categories: ["necessary", "analytics"] });
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

  test("round-trips a serialized answer", () => {
    const raw = serializeConsentRecord(
      ["necessary", "analytics"],
      new Date("2026-11-07T10:00:00Z")
    );
    expect(JSON.parse(raw)).toEqual({
      categories: ["necessary", "analytics"],
      decidedAt: "2026-11-07T10:00:00.000Z",
    });
    expect(parseConsentRecord(raw)).toEqual({
      kind: "decided",
      categories: ["necessary", "analytics"],
    });
  });
});
