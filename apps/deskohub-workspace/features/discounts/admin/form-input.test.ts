import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { workspaceProductTargets } from "@/features/discounts/product-target";
import {
  readDiscountCodeForm,
  readDiscountForm,
  readVoucherConfigurationForm,
  readVoucherCreditForm,
} from "./form-input";

describe("discount administration form input", () => {
  test("reads a bounded window and clears both blank fields", () => {
    const form = new FormData();
    form.set("discountId", "019c91dd-c560-7e55-b9d8-c95065efd51d");
    form.set("code", "summer10");
    form.set("enabled", "on");
    form.set("serviceDateFrom", "2026-03-29");
    form.set("serviceDateUntil", "2026-03-30");
    expect(readDiscountCodeForm(form)).toMatchObject({
      serviceDateFrom: "2026-03-29",
      serviceDateUntil: "2026-03-30",
    });

    form.set("serviceDateFrom", "");
    form.set("serviceDateUntil", "");
    expect(readDiscountCodeForm(form)).toMatchObject({
      serviceDateFrom: null,
      serviceDateUntil: null,
    });
  });

  test("does not read service-date fields for vouchers", () => {
    const form = new FormData();
    form.set("code", "gift100");
    form.set("serviceDateFrom", "2026-03-29");
    form.set("serviceDateUntil", "2026-03-30");

    expect(readVoucherConfigurationForm(form)).not.toHaveProperty(
      "serviceDateFrom"
    );
    expect(readVoucherConfigurationForm(form)).not.toHaveProperty(
      "serviceDateUntil"
    );
  });
  test("converts a percentage value to stored basis points", () => {
    const formData = new FormData();
    formData.set("adjustmentKind", "percentage");
    formData.set("percentage", "10.25");
    formData.set("labelCs", "Letní sleva");
    formData.set("labelEn", "Summer discount");
    formData.append("products", "cowork");

    expect(readDiscountForm(formData).adjustment).toEqual({
      kind: "percentage",
      basisPoints: 1025,
    });
  });

  test("accepts every product offered by the catalog", () => {
    for (const identity of workspaceProductTargets) {
      const formData = new FormData();
      formData.set("adjustmentKind", "percentage");
      formData.set("percentage", "10");
      formData.append("products", identity.kind);

      expect(readDiscountForm(formData).products).toEqual([identity]);
    }
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

  test("reads voucher credit in the selected catalog currency", () => {
    const formData = new FormData();
    formData.set("voucherValue", "10000");
    formData.set("voucherCurrency", "czk");

    expect(readVoucherCreditForm(formData)).toEqual({
      value: 10_000,
      exponent: 2,
      currency: "CZK",
    });
  });
});
