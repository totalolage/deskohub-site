import { Schema } from "effect";
import {
  getWorkspaceProductKey,
  workspaceProductIdentitySchema,
} from "@/features/checkout/product-identity";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { findWorkspaceCurrencyDefinition } from "@/shared/money/currencies";
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

const adminDiscountAdjustmentSchema = discountAdjustmentSchema.check(
  Schema.makeFilter(
    (adjustment) =>
      adjustment.kind === "percentage" ||
      findWorkspaceCurrencyDefinition(adjustment.amount.currency)?.exponent ===
        adjustment.amount.exponent || {
        path: ["amount", "currency"],
        issue: "currency must be supported by Workspace",
      }
  )
);

export const discountAdminLabelsSchema = Schema.Struct({
  "cs-CZ": discountLabelSchema,
  "en-US": discountLabelSchema,
});

const discountDefinitionSchema = Schema.Struct({
  labels: discountAdminLabelsSchema,
  adjustment: adminDiscountAdjustmentSchema,
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
});

export const createDiscountAdminInputSchema = discountDefinitionSchema;

export const updateDiscountAdminInputSchema = Schema.Struct({
  id: storedDiscountIdSchema,
  ...discountDefinitionSchema.fields,
});

const discountCodeConfigurationSchema = Schema.Struct({
  code: canonicalDiscountCodeSchema,
  enabled: Schema.Boolean,
  validFrom: Schema.NullOr(instantStringSchema),
  validUntil: Schema.NullOr(instantStringSchema),
  maxUses: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
});

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

const discountSelectionSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("existing"),
    discountId: storedDiscountIdSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("new"),
    discount: createDiscountAdminInputSchema,
  }),
]);

export const createDiscountCodeAdminInputSchema = Schema.Struct({
  discountId: storedDiscountIdSchema,
  ...discountCodeConfigurationSchema.fields,
}).check(validCodeWindow);

export const createManagedDiscountCodeAdminInputSchema = Schema.Struct({
  code: discountCodeConfigurationSchema.check(validCodeWindow),
  discount: discountSelectionSchema,
});

export const updateDiscountCodeAdminInputSchema = Schema.Struct({
  id: discountCodeIdSchema,
  discountId: storedDiscountIdSchema,
  ...discountCodeConfigurationSchema.fields,
}).check(validCodeWindow);

export const createCustomerDiscountCodeAdminInputSchema = Schema.Struct({
  customerId: dotyposCustomerIdSchema,
  code: discountCodeConfigurationSchema.check(validCodeWindow),
  discount: discountSelectionSchema,
});

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
    ...createManagedDiscountCodeAdminInputSchema.fields,
  }),
  Schema.Struct({
    kind: Schema.Literal("create-customer-code"),
    ...createCustomerDiscountCodeAdminInputSchema.fields,
  }),
  Schema.Struct({
    kind: Schema.Literal("update-code"),
    code: updateDiscountCodeAdminInputSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("delete-code"),
    id: discountCodeIdSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("add-code-customer"),
    codeId: discountCodeIdSchema,
    customerId: dotyposCustomerIdSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("remove-code-customer"),
    codeId: discountCodeIdSchema,
    customerId: dotyposCustomerIdSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("make-code-unrestricted"),
    codeId: discountCodeIdSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("set-customer-discount-group"),
    customerId: dotyposCustomerIdSchema,
    discountGroupId: Schema.NullOr(Schema.Trim.check(Schema.isNonEmpty())),
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

export const discountAdminCustomerSearchSchema = Schema.Struct({
  query: Schema.Trim.check(
    Schema.isMinLength(2),
    Schema.isMaxLength(100),
    Schema.isPattern(/^[^|;]+$/)
  ),
});

export const discountAdminCustomerSearchStandardSchema =
  Schema.toStandardSchemaV1(discountAdminCustomerSearchSchema, {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  });

export type CreateDiscountAdminInput =
  typeof createDiscountAdminInputSchema.Type;
export type UpdateDiscountAdminInput =
  typeof updateDiscountAdminInputSchema.Type;
export type CreateDiscountCodeAdminInput =
  typeof createDiscountCodeAdminInputSchema.Type;
export type CreateManagedDiscountCodeAdminInput =
  typeof createManagedDiscountCodeAdminInputSchema.Type;
export type CreateCustomerDiscountCodeAdminInput =
  typeof createCustomerDiscountCodeAdminInputSchema.Type;
export type UpdateDiscountCodeAdminInput =
  typeof updateDiscountCodeAdminInputSchema.Type;
export type DiscountAdminMutation = typeof discountAdminMutationSchema.Type;
export type DiscountAdminCustomerSearch =
  typeof discountAdminCustomerSearchSchema.Type;
