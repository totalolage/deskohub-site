import type { AdministrationDiscountMutationResultType } from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import type { DiscountAdminMutation } from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";

export const executeDiscountAdminMutation = Effect.fn(
  "DiscountAdministration.executeMutation"
)(function* (input: DiscountAdminMutation) {
  const admin = yield* DiscountAdministration;
  const noCreatedIdResult: AdministrationDiscountMutationResultType = {
    kind: input.kind,
    createdDiscountId: null,
    createdCodeId: null,
    createdVoucherId: null,
  };

  return yield* Match.value(input).pipe(
    Match.discriminatorsExhaustive("kind")({
      "create-discount": ({ discount, kind }) =>
        admin.createDiscount(discount).pipe(
          Effect.map(
            (createdDiscountId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId,
              createdCodeId: null,
              createdVoucherId: null,
            })
          )
        ),
      "update-discount": ({ discount }) =>
        Effect.as(admin.updateDiscount(discount), noCreatedIdResult),
      "delete-discount": ({ id }) =>
        Effect.as(admin.deleteDiscount({ id }), noCreatedIdResult),
      "create-code": ({ code, discount, kind }) =>
        admin.createCode({ code, discount }).pipe(
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
        admin.createCustomerCode({ code, customerId, discount }).pipe(
          Effect.map(
            (createdCodeId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId: null,
              createdCodeId,
              createdVoucherId: null,
            })
          )
        ),
      "update-code": ({ code }) =>
        Effect.as(admin.updateCode(code), noCreatedIdResult),
      "delete-code": ({ id }) =>
        Effect.as(admin.deleteCode({ id }), noCreatedIdResult),
      "add-code-customer": ({ codeId, customerId }) =>
        Effect.as(
          admin.addCodeCustomer({ codeId, customerId }),
          noCreatedIdResult
        ),
      "remove-code-customer": ({ codeId, customerId }) =>
        Effect.as(
          admin.removeCodeCustomer({ codeId, customerId }),
          noCreatedIdResult
        ),
      "make-code-unrestricted": ({ codeId }) =>
        Effect.as(admin.makeCodeUnrestricted({ codeId }), noCreatedIdResult),
      "set-customer-discount-group": ({ customerId, discountGroupId }) =>
        Effect.as(
          admin.setCustomerDiscountGroup({ customerId, discountGroupId }),
          noCreatedIdResult
        ),
      "create-voucher": ({ kind, voucher }) =>
        admin.createVoucher(voucher).pipe(
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
        admin.createCustomerVoucher(voucher).pipe(
          Effect.map(
            (createdVoucherId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId: null,
              createdCodeId: null,
              createdVoucherId,
            })
          )
        ),
      "update-voucher": ({ voucher }) =>
        Effect.as(admin.updateVoucher(voucher), noCreatedIdResult),
      "delete-voucher": ({ id }) =>
        Effect.as(admin.deleteVoucher({ id }), noCreatedIdResult),
      "add-voucher-customer": ({ customerId, voucherId }) =>
        Effect.as(
          admin.addVoucherCustomer({ customerId, voucherId }),
          noCreatedIdResult
        ),
      "remove-voucher-customer": ({ customerId, voucherId }) =>
        Effect.as(
          admin.removeVoucherCustomer({ customerId, voucherId }),
          noCreatedIdResult
        ),
      "make-voucher-unrestricted": ({ voucherId }) =>
        Effect.as(
          admin.makeVoucherUnrestricted({ voucherId }),
          noCreatedIdResult
        ),
    })
  );
});
