import { expect, test } from "bun:test";
import { AdministrationInvoiceCreateInput } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { getInvoiceReviewTotal, readInvoiceForm } from "./invoice-form";

test("calculates the immutable review total without losing precision", () => {
  expect(
    getInvoiceReviewTotal([
      { price: "900719925474099312345678.02" },
      { price: "-0.01" },
    ])
  ).toBe("900719925474099312345678.01");
  expect(getInvoiceReviewTotal([{ price: "not-a-price" }])).toBeNull();
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
    defaultVariableSymbol: "2026000001",
    form,
    invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21",
    lines: [{ id: "line-1", description: "", price: "" }],
  });

  expect(input.customer.details).not.toHaveProperty("firstName");
  expect(input.customer.details).not.toHaveProperty("lastName");
  expect(() =>
    Schema.decodeUnknownSync(AdministrationInvoiceCreateInput)(input)
  ).not.toThrow();
});
