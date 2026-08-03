"use server";

import { Effect, Match } from "effect";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { requireDiscountAdminAuthorization } from "./basic-auth.server";
import {
  type DiscountAdminCustomerSearch,
  type DiscountAdminMutation,
  discountAdminCustomerSearchStandardSchema,
  discountAdminMutationStandardSchema,
} from "./contracts";
import { DiscountAdministrationLive } from "./discount-administration.runtime";
import { DiscountAdministration } from "./discount-administration.service";

const executeDiscountAdminMutation = Effect.fn(
  "DiscountAdministration.executeMutation"
)(function* (input: DiscountAdminMutation) {
  const administration = yield* DiscountAdministration;

  yield* Match.value(input).pipe(
    Match.discriminatorsExhaustive("kind")({
      "create-discount": ({ discount }) =>
        administration.createDiscount(discount),
      "update-discount": ({ discount }) =>
        administration.updateDiscount(discount),
      "delete-discount": ({ id }) => administration.deleteDiscount({ id }),
      "create-code": ({ code }) => administration.createCode(code),
      "update-code": ({ code }) => administration.updateCode(code),
      "delete-code": ({ id }) => administration.deleteCode({ id }),
      "add-code-customer": ({ codeId, customerId }) =>
        administration.addCodeCustomer({ codeId, customerId }),
      "remove-code-customer": ({ codeId, customerId }) =>
        administration.removeCodeCustomer({ codeId, customerId }),
      "make-code-unrestricted": ({ codeId }) =>
        administration.makeCodeUnrestricted({ codeId }),
      "set-customer-discount-group": ({ customerId, discountGroupId }) =>
        administration.setCustomerDiscountGroup({
          customerId,
          discountGroupId,
        }),
    })
  );

  return {
    notice: Match.value(input.kind).pipe(
      Match.when("create-discount", () => "Discount created."),
      Match.when("update-discount", () => "Discount updated."),
      Match.when("delete-discount", () => "Discount deleted."),
      Match.when("create-code", () => "Discount code created."),
      Match.when("update-code", () => "Discount code updated."),
      Match.when("delete-code", () => "Discount code deleted."),
      Match.when(
        "add-code-customer",
        () => "Customer added to the code audience."
      ),
      Match.when(
        "remove-code-customer",
        () => "Customer removed from the code audience."
      ),
      Match.when("make-code-unrestricted", () => "Code made unrestricted."),
      Match.when(
        "set-customer-discount-group",
        () => "Customer discount group updated."
      ),
      Match.exhaustive
    ),
  };
});

const discountAdminMutationAction = defineWorkspaceAction(
  {
    operation: "discount-administration.mutate",
    schema: discountAdminMutationStandardSchema,
  },
  (input) =>
    requireDiscountAdminAuthorization().pipe(
      Effect.andThen(executeDiscountAdminMutation(input)),
      Effect.provide(DiscountAdministrationLive),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: Match.value(cause).pipe(
              Match.tag("DiscountAdminNotFoundError", ({ message }) => message),
              Match.tag("DiscountAdminAudienceError", ({ message }) => message),
              Match.orElse(
                () =>
                  "The change could not be saved. Check the values and any existing references, then try again."
              )
            ),
            cause,
          })
      )
    )
);

const executeCustomerSearch = Effect.fn(
  "DiscountAdministration.executeCustomerSearch"
)((input: DiscountAdminCustomerSearch) =>
  Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.searchCustomers(input);
  })
);

const discountAdminCustomerSearchAction = defineWorkspaceAction(
  {
    operation: "discount-administration.search-customers",
    schema: discountAdminCustomerSearchStandardSchema,
    logInput: false,
  },
  (input) =>
    requireDiscountAdminAuthorization().pipe(
      Effect.andThen(executeCustomerSearch(input)),
      Effect.provide(DiscountAdministrationLive),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: "Dotypos customer search is temporarily unavailable.",
            cause,
          })
      )
    )
);

export const mutateDiscountAdmin: typeof discountAdminMutationAction = async (
  ...args: Parameters<typeof discountAdminMutationAction>
) => {
  "use server";
  return await discountAdminMutationAction(...args);
};

export const searchDiscountAdminCustomers: typeof discountAdminCustomerSearchAction =
  async (...args: Parameters<typeof discountAdminCustomerSearchAction>) => {
    "use server";
    return await discountAdminCustomerSearchAction(...args);
  };
