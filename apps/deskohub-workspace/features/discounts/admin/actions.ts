"use server";

import { Effect, Match } from "effect";
import { revalidatePath } from "next/cache";
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

  const createdDiscountId = yield* Match.value(input).pipe(
    Match.discriminatorsExhaustive("kind")({
      "create-discount": ({ discount }) =>
        administration.createDiscount(discount),
      "update-discount": ({ discount }) =>
        administration.updateDiscount(discount).pipe(Effect.as(null)),
      "delete-discount": ({ id }) =>
        administration.deleteDiscount({ id }).pipe(Effect.as(null)),
      "create-code": ({ code, discount }) =>
        administration.createCode({ code, discount }).pipe(Effect.as(null)),
      "create-customer-code": ({ code, customerId, discount }) =>
        administration
          .createCustomerCode({ code, customerId, discount })
          .pipe(
            Effect.tap(() =>
              Effect.sync(() =>
                revalidatePath(`/admin/customers/${customerId}`)
              )
            )
          )
          .pipe(Effect.as(null)),
      "update-code": ({ code }) =>
        administration.updateCode(code).pipe(Effect.as(null)),
      "delete-code": ({ id }) =>
        administration.deleteCode({ id }).pipe(Effect.as(null)),
      "add-code-customer": ({ codeId, customerId }) =>
        administration
          .addCodeCustomer({ codeId, customerId })
          .pipe(Effect.as(null)),
      "remove-code-customer": ({ codeId, customerId }) =>
        administration
          .removeCodeCustomer({ codeId, customerId })
          .pipe(Effect.as(null)),
      "make-code-unrestricted": ({ codeId }) =>
        administration.makeCodeUnrestricted({ codeId }).pipe(Effect.as(null)),
      "set-customer-discount-group": ({ customerId, discountGroupId }) =>
        administration
          .setCustomerDiscountGroup({
            customerId,
            discountGroupId,
          })
          .pipe(Effect.as(null)),
    })
  );

  return {
    ...(createdDiscountId && { createdDiscountId }),
    notice: Match.value(input.kind).pipe(
      Match.when("create-discount", () => "Discount created."),
      Match.when("update-discount", () => "Discount updated."),
      Match.when("delete-discount", () => "Discount deleted."),
      Match.when("create-code", () => "Discount code created."),
      Match.when(
        "create-customer-code",
        () => "Discount code created for this customer."
      ),
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
            message: "Customer search is temporarily unavailable.",
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
