import { Schema } from "effect";
import { discountIdSchema } from "./contracts";

export {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
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

export const promotionCodeIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("PromotionCodeId")
).annotate({
  identifier: "PromotionCodeId",
  description: "Opaque identifier for a submitted promotion code.",
});

export type PromotionCodeId = Schema.Schema.Type<typeof promotionCodeIdSchema>;

export const voucherIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("VoucherId")
).annotate({
  identifier: "VoucherId",
  description: "Opaque identifier for a promotional credit voucher.",
});

export type VoucherId = Schema.Schema.Type<typeof voucherIdSchema>;

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

export const voucherClaimIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("VoucherClaimId")
).annotate({
  identifier: "VoucherClaimId",
  description: "Opaque identifier for a voucher claim lifecycle.",
});

export type VoucherClaimId = Schema.Schema.Type<typeof voucherClaimIdSchema>;
