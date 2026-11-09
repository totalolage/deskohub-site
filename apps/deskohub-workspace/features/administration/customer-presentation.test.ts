import { describe, expect, test } from "bun:test";
import { getAdministrationCustomerName } from "./customer-presentation";

describe("customer presentation", () => {
  test("shows the customer's own name in every locale", () => {
    const customer = { displayName: "Ada Lovelace", hasName: true };

    expect(getAdministrationCustomerName(customer, "en-US")).toBe(
      "Ada Lovelace"
    );
    expect(getAdministrationCustomerName(customer, "cs-CZ")).toBe(
      "Ada Lovelace"
    );
  });

  test("names an unnamed customer in the route language", () => {
    const customer = { displayName: "Unnamed customer", hasName: false };

    expect(getAdministrationCustomerName(customer, "en-US")).toBe(
      "Unnamed customer"
    );
    expect(getAdministrationCustomerName(customer, "cs-CZ")).toBe(
      "Zákazník bez jména"
    );
  });
});
