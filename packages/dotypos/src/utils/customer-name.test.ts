import { describe, expect, test } from "bun:test";
import { getCustomerDisplayName } from "./customer-name";

describe("getCustomerDisplayName", () => {
  test.each([
    [{ firstName: " Ada ", lastName: " Lovelace " }, "Ada Lovelace"],
    [{ firstName: "Ada", lastName: null }, "Ada"],
    [
      { firstName: " ", lastName: "", companyName: " Synthetic s.r.o. " },
      "Synthetic s.r.o.",
    ],
    [{ firstName: null, lastName: null, companyName: " " }, undefined],
  ] as const)("names %o as %p", (customer, expected) => {
    expect(getCustomerDisplayName(customer)).toBe(expected);
  });
});
