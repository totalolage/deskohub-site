import { describe, expect, test } from "bun:test";
import { getAdministrationRedirectUrl } from "./administration-redirect";

describe("getAdministrationRedirectUrl", () => {
  test("preserves scalar and repeated query parameters", () => {
    expect(
      getAdministrationRedirectUrl("/admin/nexi/operations", {
        channel: "ECOMMERCE",
        from: "2026-08-01",
        operationType: ["CAPTURE", "REFUND"],
        omitted: undefined,
      })
    ).toBe(
      "/admin/nexi/operations?channel=ECOMMERCE&from=2026-08-01&operationType=CAPTURE&operationType=REFUND"
    );
  });

  test("does not append an empty query string", () => {
    expect(getAdministrationRedirectUrl("/admin/nexi/orders", {})).toBe(
      "/admin/nexi/orders"
    );
  });
});
