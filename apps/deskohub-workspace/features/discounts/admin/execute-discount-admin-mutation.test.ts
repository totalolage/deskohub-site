import { expect, test } from "bun:test";
import {
  AdministrationCanonicalPromotionCode,
  AdministrationDotyposCustomerId,
  AdministrationVoucherId,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema } from "effect";
import type { DiscountAdminMutation } from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";
import { executeDiscountAdminMutation } from "./execute-discount-admin-mutation";

const decode = Schema.decodeUnknownSync;
const voucherId = decode(AdministrationVoucherId)("voucher-1");
const customerId = decode(AdministrationDotyposCustomerId)("customer-1");

const storedVoucher = {
  id: voucherId,
  code: decode(AdministrationCanonicalPromotionCode)("SUMMER10"),
  enabled: true,
  validFrom: null,
  validUntil: null,
  credit: { value: 10000, exponent: 2, currency: "CZK" },
};

const cases = [
  { kind: "update-voucher", voucher: storedVoucher },
  { kind: "delete-voucher", id: voucherId },
  { kind: "add-voucher-customer", voucherId, customerId },
  { kind: "remove-voucher-customer", voucherId, customerId },
  { kind: "make-voucher-unrestricted", voucherId },
] satisfies ReadonlyArray<DiscountAdminMutation>;

test("executes voucher mutations through their administration services", async () => {
  const calls: string[] = [];
  const record = (name: string) =>
    Effect.sync(() => {
      calls.push(name);
    });
  const administration = Layer.mock(DiscountAdministration, {
    updateVoucher: () => record("updateVoucher"),
    deleteVoucher: () => record("deleteVoucher"),
    addVoucherCustomer: () => record("addVoucherCustomer"),
    removeVoucherCustomer: () => record("removeVoucherCustomer"),
    makeVoucherUnrestricted: () => record("makeVoucherUnrestricted"),
  });

  const results = await Effect.runPromise(
    Effect.forEach(cases, executeDiscountAdminMutation, {
      concurrency: 1,
    }).pipe(Effect.provide(administration))
  );

  expect(calls).toEqual([
    "updateVoucher",
    "deleteVoucher",
    "addVoucherCustomer",
    "removeVoucherCustomer",
    "makeVoucherUnrestricted",
  ]);
  const noCreatedId = {
    createdDiscountId: null,
    createdCodeId: null,
    createdVoucherId: null,
  };
  expect(results).toEqual(cases.map(({ kind }) => ({ kind, ...noCreatedId })));
});
