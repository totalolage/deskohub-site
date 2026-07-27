import { Schema } from "effect";
import {
  getWorkspaceProductKey,
  workspaceProductIdentitySchema,
} from "@/features/checkout/product-identity";
import { instantStringSchema } from "@/shared/utils";
import {
  canonicalDiscountCodeSchema,
  discountAdjustmentSchema,
} from "../contracts";
import {
  discountCodeIdSchema,
  storedDiscountIdSchema,
} from "../persistence-contracts";

const discountLabelSchema = Schema.Trim.check(Schema.isNonEmpty());

export const discountAdminLabelsSchema = Schema.Struct({
  "cs-CZ": discountLabelSchema,
  "en-US": discountLabelSchema,
});

const discountFields = {
  labels: discountAdminLabelsSchema,
  adjustment: discountAdjustmentSchema,
  products: Schema.NonEmptyArray(workspaceProductIdentitySchema).check(
    Schema.makeFilter(
      (products) =>
        new Set(products.map(getWorkspaceProductKey)).size ===
          products.length || {
          path: [],
          issue: "product targets must be unique",
        }
    )
  ),
};

export const createDiscountAdminInputSchema = Schema.Struct(discountFields);

export const updateDiscountAdminInputSchema = Schema.Struct({
  id: storedDiscountIdSchema,
  ...discountFields,
});

const codeFields = {
  discountId: storedDiscountIdSchema,
  code: canonicalDiscountCodeSchema,
  enabled: Schema.Boolean,
  validFrom: Schema.NullOr(instantStringSchema),
  validUntil: Schema.NullOr(instantStringSchema),
  maxUses: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
};

const validCodeWindow = Schema.makeFilter<{
  readonly validFrom: string | null;
  readonly validUntil: string | null;
}>(
  ({ validFrom, validUntil }) =>
    validFrom === null ||
    validUntil === null ||
    Temporal.Instant.compare(
      Temporal.Instant.from(validUntil),
      Temporal.Instant.from(validFrom)
    ) > 0 || {
      path: ["validUntil"],
      issue: "validUntil must be later than validFrom",
    }
);

export const createDiscountCodeAdminInputSchema =
  Schema.Struct(codeFields).check(validCodeWindow);

export const updateDiscountCodeAdminInputSchema = Schema.Struct({
  id: discountCodeIdSchema,
  ...codeFields,
}).check(validCodeWindow);

export const discountAdminMutationSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create-discount"),
    discount: createDiscountAdminInputSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("update-discount"),
    discount: updateDiscountAdminInputSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("delete-discount"),
    id: storedDiscountIdSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("create-code"),
    code: createDiscountCodeAdminInputSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("update-code"),
    code: updateDiscountCodeAdminInputSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("delete-code"),
    id: discountCodeIdSchema,
  }),
]);

export const discountAdminMutationStandardSchema = Schema.toStandardSchemaV1(
  discountAdminMutationSchema,
  {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  }
);

export type CreateDiscountAdminInput =
  typeof createDiscountAdminInputSchema.Type;
export type UpdateDiscountAdminInput =
  typeof updateDiscountAdminInputSchema.Type;
export type CreateDiscountCodeAdminInput =
  typeof createDiscountCodeAdminInputSchema.Type;
export type UpdateDiscountCodeAdminInput =
  typeof updateDiscountCodeAdminInputSchema.Type;
export type DiscountAdminMutation = typeof discountAdminMutationSchema.Type;
