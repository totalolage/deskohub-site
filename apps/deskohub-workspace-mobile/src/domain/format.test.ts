import { describe, expect, test } from "bun:test";

import { formatMoney, formatPragueDateTime, localizeText } from "./format";

describe("shop formatting", () => {
  test("formats Czech crown values from minor units", () => {
    const value = formatMoney({ currency: "CZK", minorUnits: 4900 }, "cs");
    expect(value).toContain("49");
    expect(value).toMatch(/Kč|CZK/);
  });

  test("keeps Prague time stable across viewer time zones", () => {
    expect(formatPragueDateTime("2026-08-11T10:00:00.000Z", "en")).toContain(
      "12:00"
    );
  });

  test("selects the requested localized menu text", () => {
    expect(localizeText({ cs: "Voda", en: "Water" }, "en")).toBe("Water");
  });
});
