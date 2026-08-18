import { expect, test } from "bun:test";
import { AdministrationInvoiceCreateInput } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import {
  getInvoiceReviewTotal,
  isInvoicePriceInput,
  readInvoiceForm,
} from "./invoice-form";

test("calculates the immutable review total without losing precision", () => {
  expect(
    getInvoiceReviewTotal([
      { price: "900719925474099312345678.02" },
      { price: "-0.01" },
    ])
  ).toBe("900719925474099312345678.01");
  expect(getInvoiceReviewTotal([{ price: "not-a-price" }])).toBeNull();
});

test("rejects prices beyond the selected currency precision", () => {
  expect(getInvoiceReviewTotal([{ price: "1.234" }], 2)).toBeNull();
  expect(getInvoiceReviewTotal([{ price: "-1.23" }], 2)).toBe("-1.23");
  expect(isInvoicePriceInput("1.234", 2)).toBeFalse();
  expect(isInvoicePriceInput("-1.23", 2)).toBeTrue();
});

test("omits blank optional business contact names", () => {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    email: "billing@example.test",
    firstName: "",
    lastName: "",
    line1: "Synthetic 1",
    city: "Prague",
    postalCode: "110 00",
    country: "CZ",
    companyName: "Example s.r.o.",
    companyId: "12345678",
    locale: "en-US",
    serviceDate: "2026-08-18",
    dueDate: "2026-09-01",
    currency: "CZK",
    variableSymbol: "2026000001",
    "description-line-1": "Space rental",
    "price-line-1": "1000",
  })) {
    form.set(name, value);
  }

  const input = readInvoiceForm({
    customer: null,
    customerMode: "new",
    customerType: "business",
    form,
    invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21",
    lines: [{ id: "line-1", description: "", price: "" }],
  });

  expect(input.customer.details).not.toHaveProperty("firstName");
  expect(input.customer.details).not.toHaveProperty("lastName");
  expect(input.variableSymbol).toBe("2026000001");
  expect(() =>
    Schema.decodeUnknownSync(AdministrationInvoiceCreateInput)(input)
  ).not.toThrow();
});
