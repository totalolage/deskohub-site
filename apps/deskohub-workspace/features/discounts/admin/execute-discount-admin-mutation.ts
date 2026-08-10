import type { AdministrationDiscountMutationResultType } from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import type { DiscountAdminMutation } from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";

export const executeDiscountAdminMutation = Effect.fn(
  "DiscountAdministration.executeMutation"
)(function* (input: DiscountAdminMutation) {
  const administration = yield* DiscountAdministration;

  return yield* Match.value(input).pipe(
    Match.discriminatorsExhaustive("kind")({
      "create-discount": ({ discount, kind }) =>
        administration.createDiscount(discount).pipe(
          Effect.map(
            (createdDiscountId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId,
              createdCodeId: null,
            })
          )
        ),
      "update-discount": ({ discount, kind }) =>
        administration.updateDiscount(discount).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "delete-discount": ({ id, kind }) =>
        administration.deleteDiscount({ id }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "create-code": ({ code, discount, kind }) =>
        administration.createCode({ code, discount }).pipe(
          Effect.map(
            (createdCodeId): AdministrationDiscountMutationResultType => ({
              kind,
              createdDiscountId: null,
              createdCodeId,
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
            })
          )
        ),
      "update-code": ({ code, kind }) =>
        administration.updateCode(code).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "delete-code": ({ id, kind }) =>
        administration.deleteCode({ id }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "add-code-customer": ({ codeId, customerId, kind }) =>
        administration.addCodeCustomer({ codeId, customerId }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "remove-code-customer": ({ codeId, customerId, kind }) =>
        administration.removeCodeCustomer({ codeId, customerId }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
          } satisfies AdministrationDiscountMutationResultType)
        ),
      "make-code-unrestricted": ({ codeId, kind }) =>
        administration.makeCodeUnrestricted({ codeId }).pipe(
          Effect.as({
            kind,
            createdDiscountId: null,
            createdCodeId: null,
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
            } satisfies AdministrationDiscountMutationResultType)
          ),
    })
  );
});
