import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Option, Schema } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  nonNegativeWorkspaceMoneyCodec,
  positiveWorkspaceMoneyCodec,
} from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import {
  type WorkspaceCoworkProductIdentity,
  workspaceCoworkProductIdentitySchema,
} from "@/features/reservation/cowork-reservation-product";
import { instantStringSchema } from "@/shared/utils/temporal";

export const discountIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("DiscountId")
).annotate({
  identifier: "DiscountId",
  description: "Deterministic opaque public discount identifier.",
});

export type DiscountId = Schema.Schema.Type<typeof discountIdSchema>;

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

export const discountBasisPointsSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 10_000 })
).annotate({
  identifier: "DiscountBasisPoints",
  description: "An exact percentage discount measured in basis points.",
});

export const discountProductIdentitySchema: StandardSchemaV1<
  unknown,
  WorkspaceCoworkProductIdentity
> = Schema.toStandardSchemaV1(workspaceCoworkProductIdentitySchema, {
  parseOptions: {
    onExcessProperty: "error",
  },
});

export type DiscountAdjustment =
  | {
      readonly kind: "percentage";
      readonly basisPoints: number;
    }
  | {
      readonly kind: "fixed";
      readonly amount: WorkspaceMoney;
    };

export const discountAdjustmentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("percentage"),
    basisPoints: discountBasisPointsSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("fixed"),
    amount: positiveWorkspaceMoneyCodec,
  }),
]).annotate({
  identifier: "DiscountAdjustment",
  description: "A valid percentage or fixed-money discount adjustment.",
});

export type Discount = {
  readonly id: DiscountId;
  readonly label: string;
  readonly adjustment: DiscountAdjustment;
  readonly expiresAt?: string;
  readonly countdownStartsAt?: string;
};

export const discountCodec = Schema.Struct({
  id: discountIdSchema,
  label: Schema.NonEmptyString,
  adjustment: discountAdjustmentSchema,
  expiresAt: Schema.optionalKey(Schema.toEncoded(instantStringSchema)),
  countdownStartsAt: Schema.optionalKey(Schema.toEncoded(instantStringSchema)),
}).annotate({
  identifier: "Discount",
  description: "A source-neutral discount exposed to checkout consumers.",
});

export type AppliedDiscount = {
  readonly discount: Discount;
  readonly subtotalBefore: WorkspaceMoney;
  readonly amount: WorkspaceMoney;
  readonly subtotalAfter: WorkspaceMoney;
};

export const appliedDiscountCodec = Schema.Struct({
  discount: discountCodec,
  subtotalBefore: nonNegativeWorkspaceMoneyCodec,
  amount: positiveWorkspaceMoneyCodec,
  subtotalAfter: nonNegativeWorkspaceMoneyCodec,
}).annotate({
  identifier: "AppliedDiscount",
  description:
    "An immutable discount application and its before, applied, and after amounts.",
});

export const isAppliedDiscount = (value: unknown): value is AppliedDiscount =>
  Option.isSome(
    Schema.decodeUnknownOption(appliedDiscountCodec, {
      onExcessProperty: "error",
    })(value)
  );

export type DiscountQuote = {
  readonly product: WorkspaceCoworkProductIdentity;
  readonly discountableSubtotal: WorkspaceMoney;
  readonly discounts: readonly AppliedDiscount[];
  readonly totalDiscount: WorkspaceMoney;
  readonly discountedSubtotal: WorkspaceMoney;
};

export const discountQuoteCodec = Schema.Struct({
  product: workspaceCoworkProductIdentitySchema,
  discountableSubtotal: nonNegativeWorkspaceMoneyCodec,
  discounts: Schema.Array(appliedDiscountCodec),
  totalDiscount: nonNegativeWorkspaceMoneyCodec,
  discountedSubtotal: nonNegativeWorkspaceMoneyCodec,
}).annotate({
  identifier: "DiscountQuote",
  description: "A source-neutral discount calculation for one product.",
});

export const discountAdvertisementQuoteCodec = discountQuoteCodec
  .pipe(Schema.brand("DiscountAdvertisementQuote"))
  .annotate({
    identifier: "DiscountAdvertisementQuote",
    description:
      "A discount quote produced only by anonymous advertisement discovery or affirmation.",
  });

export type DiscountAdvertisementQuote =
  typeof discountAdvertisementQuoteCodec.Type;

export type DiscountAdvertisementInput = {
  readonly product: WorkspaceCoworkProductIdentity;
  readonly discountableSubtotal: WorkspaceMoney;
  readonly reservationDate: string;
  readonly locale: Locale;
};

export type DiscountQuoteInput = DiscountAdvertisementInput & {
  readonly dotyposCustomerId: string;
  readonly submittedCode?: CanonicalDiscountCode;
};
