import { describe, expect, test } from "bun:test";
import { getNexiHostedPaymentCustomer } from "./nexi-customer-info";

describe("getNexiHostedPaymentCustomer", () => {
  test("maps Czech customer details to Nexi's split mobile fields", () => {
    expect(
      getNexiHostedPaymentCustomer({
        id: "dotypos-customer-id",
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+420 777 777 777",
      })
    ).toEqual({
      id: "dotypos-customer-id",
      name: "Ada Lovelace",
      email: "ada@example.com",
      mobilePhone: {
        countryCallingCode: "420",
        nationalNumber: "777777777",
      },
    });
  });

  test("preserves an international customer phone prefix", () => {
    expect(
      getNexiHostedPaymentCustomer({
        id: "dotypos-customer-id",
        name: "Grace Hopper",
        email: "grace@example.com",
        phone: "+1 202 555 0123",
      }).mobilePhone
    ).toEqual({
      countryCallingCode: "1",
      nationalNumber: "2025550123",
    });
  });
});
