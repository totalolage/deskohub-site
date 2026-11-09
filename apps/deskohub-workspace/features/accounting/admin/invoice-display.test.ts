import { expect, test } from "bun:test";
import {
  getInvoiceCustomerErrorMessage,
  getInvoiceCustomerName,
  getInvoiceSourceLabel,
} from "./invoice-display";

test("labels the invoice provenance in the route locale", () => {
  expect(getInvoiceSourceLabel("dhw-cli", "cs-CZ")).toBe("CLI dhw");
  expect(getInvoiceSourceLabel("legacy", "en-US")).toBe("Legacy / unknown");
});

test("explains a rejected customer in the route locale", () => {
  expect(
    getInvoiceCustomerErrorMessage("customer-email-ambiguous", "cs-CZ")
  ).toBe(
    "Tento e-mail používá více zákazníků v Dotyposu. Vyberte správného stávajícího zákazníka."
  );
  expect(getInvoiceCustomerErrorMessage("customer-deleted", "en-US")).toBe(
    "The selected customer has been deleted."
  );
});

test("names an unnamed customer in the route locale", () => {
  const unnamed = { displayName: "Unnamed customer", hasName: false };
  expect(getInvoiceCustomerName(unnamed, "cs-CZ")).toBe("Zákazník bez jména");
  expect(getInvoiceCustomerName(unnamed, "en-US")).toBe("Unnamed customer");
  expect(
    getInvoiceCustomerName(
      { displayName: "Ada Lovelace", hasName: true },
      "cs-CZ"
    )
  ).toBe("Ada Lovelace");
});
