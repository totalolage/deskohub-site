"use server";

import { Effect, Match } from "effect";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { requireDiscountAdminAuthorization } from "./basic-auth.server";
import {
  type DiscountAdminMutation,
  discountAdminMutationStandardSchema,
} from "./contracts";
import { DiscountAdministrationLive } from "./discount-administration.runtime";
import {
  DiscountAdministration,
  DiscountAdminNotFoundError,
} from "./discount-administration.service";

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
            message:
              cause instanceof DiscountAdminNotFoundError
                ? cause.message
                : "The change could not be saved. Check the values and any existing references, then try again.",
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
