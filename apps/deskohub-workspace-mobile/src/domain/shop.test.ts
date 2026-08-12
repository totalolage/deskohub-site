import { describe, expect, test } from "bun:test";

import { getPurchaseReference } from "./shop";

describe("purchase reference", () => {
  test("prefers the customer-facing reference and falls back while loading", () => {
    expect(
      getPurchaseReference({ publicReference: "DW-2026-0042" }, "internal-id")
    ).toBe("DW-2026-0042");
    expect(getPurchaseReference(null, "internal-id")).toBe("internal-id");
  });
});
