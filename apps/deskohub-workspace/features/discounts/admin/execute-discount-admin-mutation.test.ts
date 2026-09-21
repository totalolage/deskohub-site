import { expect, test } from "bun:test";
import {
  AdministrationCanonicalPromotionCode,
  AdministrationDiscountCodeId,
  AdministrationDotyposCustomerId,
  AdministrationStoredDiscountId,
  AdministrationVoucherId,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema } from "effect";
import {
  type DiscountAdminMutation,
  discountAdminMutationSchema,
} from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";
import { executeDiscountAdminMutation } from "./execute-discount-admin-mutation";

const decode = Schema.decodeUnknownSync;
const voucherId = decode(AdministrationVoucherId)("voucher-1");
const customerId = decode(AdministrationDotyposCustomerId)("customer-1");
const discountId = decode(AdministrationStoredDiscountId)(
  "019c91dd-c560-7e55-b9d8-c95065efd51d"
);
const codeId = decode(AdministrationDiscountCodeId)("code-1");
const decodeMutation = decode(discountAdminMutationSchema);

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
  expect(results).toEqual(
    cases.map(({ kind }) => ({ kind, ...noCreatedIdResult }))
  );
});

const noCreatedIdResult = {
  createdDiscountId: null,
  createdCodeId: null,
  createdVoucherId: null,
};

test("passes code service-date fields through create and update mutations", async () => {
  const received: unknown[] = [];
  const code = {
    code: "SUMMER10",
    enabled: true,
    validFrom: null,
    validUntil: null,
    maxUses: 10,
    serviceDateFrom: "2026-08-10",
    serviceDateUntil: "2026-08-12",
  };
  const mutations = [
    decodeMutation({
      kind: "create-code",
      code,
      discount: { kind: "existing", discountId },
    }),
    decodeMutation({
      kind: "update-code",
      code: { id: codeId, discountId, ...code },
    }),
  ] satisfies ReadonlyArray<DiscountAdminMutation>;

  const administration = Layer.mock(DiscountAdministration, {
    createCode: (input) =>
      Effect.sync(() => {
        received.push(input);
        return codeId;
      }),
    updateCode: (input) =>
      Effect.sync(() => {
        received.push(input);
      }),
  });

  const results = await Effect.runPromise(
    Effect.forEach(mutations, executeDiscountAdminMutation, {
      concurrency: 1,
    }).pipe(Effect.provide(administration))
  );

  expect(received[0]).toMatchObject({
    code: { serviceDateFrom: "2026-08-10", serviceDateUntil: "2026-08-12" },
  });
  expect(received[1]).toMatchObject({
    serviceDateFrom: "2026-08-10",
    serviceDateUntil: "2026-08-12",
  });
  expect(results[1]).toEqual({ kind: "update-code", ...noCreatedIdResult });
});
