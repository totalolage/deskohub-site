import { Schema } from "effect";
import { discountIdSchema, discountProductIdentityCodec } from "./contracts";

export const storedDiscountIdSchema = discountIdSchema
  .check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  )
  .pipe(Schema.brand("StoredDiscountId"))
  .annotate({
    identifier: "StoredDiscountId",
    description: "Opaque UUID identifier for a stored discount definition.",
  });

export type StoredDiscountId = Schema.Schema.Type<
  typeof storedDiscountIdSchema
>;

export const discountProductKeySchema = Schema.TemplateLiteral([
  discountProductIdentityCodec.fields.kind,
  ":",
  discountProductIdentityCodec.fields.tier,
])
  .pipe(Schema.brand("DiscountProductKey"))
  .annotate({
    identifier: "DiscountProductKey",
    description: "Canonical key for a product targeted by a stored discount.",
  });

export type DiscountProductKey = Schema.Schema.Type<
  typeof discountProductKeySchema
>;

export const canonicalDiscountCodeSchema = Schema.String.check(
  Schema.isPattern(/^[A-Z0-9][A-Z0-9_-]{2,63}$/)
)
  .pipe(Schema.brand("CanonicalDiscountCode"))
  .annotate({
    identifier: "CanonicalDiscountCode",
    description:
      "Canonical ASCII-uppercase discount code accepted by Workspace checkout.",
  });

export type CanonicalDiscountCode = Schema.Schema.Type<
  typeof canonicalDiscountCodeSchema
>;

export const discountCodeIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("DiscountCodeId")
).annotate({
  identifier: "DiscountCodeId",
  description: "Opaque identifier for a stored discount code.",
});

export type DiscountCodeId = Schema.Schema.Type<typeof discountCodeIdSchema>;

export const discountApplicationIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("DiscountApplicationId")
).annotate({
  identifier: "DiscountApplicationId",
  description: "Opaque identifier for an immutable discount application.",
});

export type DiscountApplicationId = Schema.Schema.Type<
  typeof discountApplicationIdSchema
>;

export const discountCodeClaimIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("DiscountCodeClaimId")
).annotate({
  identifier: "DiscountCodeClaimId",
  description: "Opaque identifier for a discount-code claim lifecycle.",
});

export type DiscountCodeClaimId = Schema.Schema.Type<
  typeof discountCodeClaimIdSchema
>;
