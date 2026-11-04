import { Option, Schema } from "effect";
import { storedDiscountIdSchema } from "@/features/discounts/persistence-contracts";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type {
  CreateCustomerDiscountCodeAdminInput,
  DiscountAdminMutation,
} from "./contracts";
import {
  toCreateDiscountInput,
  toDiscountCodeConfigurationInput,
} from "./form-input";
import type { DiscountCodeCreationFormValues } from "./form-schemas";

const decodeStoredDiscountId = Schema.decodeUnknownSync(storedDiscountIdSchema);

type DiscountCodeCreationMutation = Extract<
  DiscountAdminMutation,
  { readonly kind: "create-code" | "create-customer-code" }
>;

/**
 * The mutation a submitted code creation form asks for: a code restricted to
 * the customer when one is given, otherwise a general code. None when the
 * form's new discount has no valid adjustment.
 */
export const toDiscountCodeCreationMutation = (
  values: DiscountCodeCreationFormValues,
  customerId: DotyposCustomerId | undefined
): Option.Option<DiscountCodeCreationMutation> =>
  Option.map(toCodeCreationDiscount(values), (discount) => {
    const code = toDiscountCodeConfigurationInput(values);
    return customerId
      ? { kind: "create-customer-code", customerId, code, discount }
      : { kind: "create-code", code, discount };
  });

const toCodeCreationDiscount = (
  values: DiscountCodeCreationFormValues
): Option.Option<CreateCustomerDiscountCodeAdminInput["discount"]> =>
  values.discountKind === "existing"
    ? Option.some({
        kind: "existing",
        discountId: decodeStoredDiscountId(values.discountId),
      })
    : Option.map(toCreateDiscountInput(values), (definition) => ({
        kind: "new",
        discount: definition,
      }));
