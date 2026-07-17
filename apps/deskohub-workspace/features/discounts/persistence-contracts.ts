import { Schema } from "effect";
import { discountIdSchema } from "./contracts";

export {
  type CanonicalDiscountCode,
  canonicalDiscountCodeSchema,
} from "./contracts";

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
