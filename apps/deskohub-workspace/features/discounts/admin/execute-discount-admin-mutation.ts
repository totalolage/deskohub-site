import type { AdministrationDiscountMutationResultType } from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import { revalidateTag } from "next/cache";
import { activePublicSalesCacheTag } from "@/shared/utils/cache-tags";
import type { DiscountAdminMutation } from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";

export const executeDiscountAdminMutation = Effect.fn(
  "DiscountAdministration.executeMutation"
)(function* (input: DiscountAdminMutation) {
  const administration = yield* DiscountAdministration;

  const result = yield* Match.value(input).pipe(
    Match.discriminatorsExhaustive("kind")({
      "create-discount": ({ discount, kind }) =>
        administration.createDiscount(discount).pipe(
          Effect.map(
            (createdDiscountId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId,
              createdCodeId: null,
              createdVoucherId: null,
            })
          )
        ),
      "update-discount": ({ discount, kind }) =>
        administration.updateDiscount(discount).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "delete-discount": ({ id, kind }) =>
        administration.deleteDiscount({ id }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "create-code": ({ code, discount, kind }) =>
        administration.createCode({ code, discount }).pipe(
          Effect.map(
            (createdCodeId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId: null,
              createdCodeId,
              createdVoucherId: null,
            })
          )
        ),
      "create-customer-code": ({ code, customerId, discount, kind }) =>
        administration.createCustomerCode({ code, customerId, discount }).pipe(
          Effect.map(
            (createdCodeId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId: null,
              createdCodeId,
              createdVoucherId: null,
            })
          )
        ),
      "update-code": ({ code, kind }) =>
        administration.updateCode(code).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "delete-code": ({ id, kind }) =>
        administration.deleteCode({ id }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "add-code-customer": ({ codeId, customerId, kind }) =>
        administration.addCodeCustomer({ codeId, customerId }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "remove-code-customer": ({ codeId, customerId, kind }) =>
        administration.removeCodeCustomer({ codeId, customerId }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "make-code-unrestricted": ({ codeId, kind }) =>
        administration.makeCodeUnrestricted({ codeId }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "set-customer-discount-group": ({ customerId, discountGroupId, kind }) =>
        administration
          .setCustomerDiscountGroup({ customerId, discountGroupId })
          .pipe(
            Effect.as({
              kind,
              createdDiscountId: null,
              createdCodeId: null,
              createdVoucherId: null,
            } satisfies AdministrationDiscountMutationResultType)
          ),
      "create-voucher": ({ kind, voucher }) =>
        administration.createVoucher(voucher).pipe(
          Effect.map(
            (createdVoucherId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId: null,
              createdCodeId: null,
              createdVoucherId,
            })
          )
        ),
      "create-customer-voucher": ({ kind, voucher }) =>
        administration.createCustomerVoucher(voucher).pipe(
          Effect.map(
            (createdVoucherId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId: null,
              createdCodeId: null,
              createdVoucherId,
            })
          )
        ),
      "update-voucher": ({ kind, voucher }) =>
        administration.updateVoucher(voucher).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "delete-voucher": ({ id, kind }) =>
        administration.deleteVoucher({ id }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "add-voucher-customer": ({ customerId, kind, voucherId }) =>
        administration.addVoucherCustomer({ customerId, voucherId }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "remove-voucher-customer": ({ customerId, kind, voucherId }) =>
        administration.removeVoucherCustomer({ customerId, voucherId }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "make-voucher-unrestricted": ({ kind, voucherId }) =>
        administration.makeVoucherUnrestricted({ voucherId }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
            createdVoucherId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
    })
  );

  if (
    input.kind === "create-discount" ||
    input.kind === "update-discount" ||
    input.kind === "delete-discount"
  ) {
    yield* Effect.sync(() =>
      revalidateTag(activePublicSalesCacheTag, { expire: 0 })
    );
  }

  return result;
});
