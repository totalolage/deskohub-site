"use server";

import { Effect, Match, Option } from "effect";
import { revalidatePath } from "next/cache";
import { requireAdministratorAuthorization } from "@/shared/administrator/administrator-authorization.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { refreshCalendarDiscountSourceAfterMutation } from "./calendar-discount-source-maintenance.server";
import {
  type DiscountAdminCustomerSearch,
  type DiscountAdminMutation,
  discountAdminCustomerSearchStandardSchema,
  discountAdminMutationStandardSchema,
} from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";
import { executeDiscountAdminMutation } from "./execute-discount-admin-mutation";

const executeDiscountAdminActionMutation = Effect.fn(
  "DiscountAdministration.executeActionMutation"
)(function* (input: DiscountAdminMutation) {
  const result = yield* executeDiscountAdminMutation(input);
  yield* refreshCalendarDiscountSourceAfterMutation(input);
  let customerPath: string | null = null;
  if (input.kind === "create-customer-code") {
    customerPath = `/admin/customers/${input.customerId}`;
  } else if (input.kind === "create-customer-voucher") {
    customerPath = `/admin/customers/${input.voucher.customerId}`;
  }
  yield* Option.fromNullOr(customerPath).pipe(
    Option.match({
      onNone: () => Effect.void,
      onSome: (path) => Effect.sync(() => revalidatePath(path)),
    })
  );

  return {
    ...(result.createdDiscountId && {
      createdDiscountId: result.createdDiscountId,
    }),
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
      Match.when("create-voucher", () => "Voucher created."),
      Match.when(
        "create-customer-voucher",
        () => "Voucher created for this customer."
      ),
      Match.when("update-voucher", () => "Voucher updated."),
      Match.when("delete-voucher", () => "Voucher deleted."),
      Match.when(
        "add-voucher-customer",
        () => "Customer added to the voucher audience."
      ),
      Match.when(
        "remove-voucher-customer",
        () => "Customer removed from the voucher audience."
      ),
      Match.when(
        "make-voucher-unrestricted",
        () => "Voucher made unrestricted."
      ),
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
    requireAdministratorAuthorization().pipe(
      Effect.andThen(executeDiscountAdminActionMutation(input)),
      Effect.provide(DiscountAdministration.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: Match.value(cause).pipe(
              Match.tag("DiscountAdminNotFoundError", ({ message }) => message),
              Match.tag("DiscountAdminAudienceError", ({ message }) => message),
              Match.tag("DiscountAdminConflictError", ({ message }) => message),
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
    requireAdministratorAuthorization().pipe(
      Effect.andThen(executeCustomerSearch(input)),
      Effect.provide(DiscountAdministration.Live),
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
