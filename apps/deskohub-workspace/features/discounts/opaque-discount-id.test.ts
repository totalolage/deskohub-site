import { describe, expect, test } from "bun:test";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";

describe("deriveOpaqueDiscountId", () => {
  test("is deterministic, opaque, and delimiter-safe", () => {
    const first = deriveOpaqueDiscountId({
      providerNamespace: "google-calendar-sales",
      providerReference: "calendar:event:2026-07-14",
    });

    expect(
      deriveOpaqueDiscountId({
        providerNamespace: "google-calendar-sales",
        providerReference: "calendar:event:2026-07-14",
      })
    ).toBe(first);
    expect(first).not.toContain("google-calendar");
    expect(first).not.toContain("event");
    expect(first).not.toBe(
      deriveOpaqueDiscountId({
        providerNamespace: "google-calendar-sales:calendar",
        providerReference: "event:2026-07-14",
      })
    );
  });
});
