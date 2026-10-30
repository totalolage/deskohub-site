import { describe, expect, test } from "bun:test";
import type { Customer as DotyposCustomer } from "@deskohub/dotypos";
import { AdministrationCustomerSearchResult } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import {
  getAdminDiscountCodeUsage,
  toAdminDotyposCustomer,
} from "./discount-administration-reads";

describe("discount administration read models", () => {
  test("counts reserved and redeemed claims against capacity but excludes releases", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 5,
        states: ["reserved", "redeemed", "released", "released"],
      })
    ).toEqual({
      reservedUses: 1,
      redeemedUses: 1,
      releasedUses: 2,
      remainingUses: 3,
    });
  });

  test("keeps unlimited capacity and floors exhausted codes at zero", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: null,
        states: ["redeemed"],
      }).remainingUses
    ).toBeNull();
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 1,
        states: ["reserved", "redeemed"],
      }).remainingUses
    ).toBe(0);
  });
});

describe("discount administration customers", () => {
  const unnamed = { id: "dotypos-customer" } as DotyposCustomer;

  test("signals a customer without a name or contact detail", () => {
    expect(toAdminDotyposCustomer(unnamed)).toMatchObject({
      displayName: "Unnamed customer",
      hasName: false,
    });
    expect(
      toAdminDotyposCustomer({ ...unnamed, phone: " +420 123 456 789 " })
    ).toMatchObject({ displayName: "+420 123 456 789", hasName: true });
  });

  test("keeps the administration API customer shape unchanged", () => {
    const encoded = Schema.encodeSync(AdministrationCustomerSearchResult)({
      kind: "matched",
      customers: [toAdminDotyposCustomer(unnamed)],
    });

    expect(encoded.customers[0]).toEqual({
      id: "dotypos-customer",
      displayName: "Unnamed customer",
      email: null,
      phone: null,
      discountGroupId: null,
    });
  });
});
