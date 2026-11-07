import { describe, expect, test } from "bun:test";
import { m } from "./messages";

describe("messages", () => {
  test("interpolates smoke totals in each locale", () => {
    const totals = { passed: 3, failed: 1, total: 4 };

    expect<string>(m.smoke_totals(totals, { locale: "en-US" })).toBe(
      "3 of 4 passed, 1 failed"
    );
    expect<string>(m.smoke_totals(totals, { locale: "cs-CZ" })).toBe(
      "3 z 4 prošlo, 1 selhalo"
    );
  });
});
