import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { readDiscountCodeForm, readDiscountForm } from "./form-input";

describe("discount administration form input", () => {
  test("converts a percentage value to stored basis points", () => {
    const formData = new FormData();
    formData.set("adjustmentKind", "percentage");
    formData.set("percentage", "10.25");
    formData.set("labelCs", "Letní sleva");
    formData.set("labelEn", "Summer discount");
    formData.append("products", "cowork:basic");

    expect(readDiscountForm(formData).adjustment).toEqual({
      kind: "percentage",
      basisPoints: 1025,
    });
  });

  test("converts local code times through the Workspace time zone", () => {
    const formData = new FormData();
    formData.set("code", "summer10");
    formData.set("discountId", "019c91dd-c560-7e55-b9d8-c95065efd51d");
    formData.set("enabled", "on");
    formData.set("validFrom", "2026-08-01T10:00");
    formData.set("validUntil", "2026-09-01T10:00");

    expect(readDiscountCodeForm(formData)).toMatchObject({
      code: "SUMMER10",
      validFrom: "2026-08-01T08:00:00Z",
      validUntil: "2026-09-01T08:00:00Z",
    });
  });
});
