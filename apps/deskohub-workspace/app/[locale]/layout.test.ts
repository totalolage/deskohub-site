import { describe, expect, test } from "bun:test";

const layoutSource = await Bun.file(
  new URL("./layout.tsx", import.meta.url)
).text();

describe("localized route layout", () => {
  test("does not own the account reservation modal slot", () => {
    expect(layoutSource).not.toContain("modal");
    expect(layoutSource).not.toContain("{modal}");
  });
});
