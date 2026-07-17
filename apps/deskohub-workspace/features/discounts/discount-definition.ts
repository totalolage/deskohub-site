import { Data, Effect, Schema } from "effect";
import type { DiscountProductTarget, StoredDiscount } from "@/db/schema";
import type { DiscountAdjustment, DiscountProductIdentity } from "./contracts";
import {
  discountAdjustmentSchema,
  discountProductIdentityCodec,
} from "./contracts";
import {
  discountProductKeySchema,
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "./persistence-contracts";

export type DiscountDefinition = {
  readonly id: StoredDiscountId;
  readonly label: string;
  readonly adjustment: DiscountAdjustment;
  readonly products: readonly DiscountProductIdentity[];
};

export type DiscountDefinitionRow = StoredDiscount & {
  readonly productTargets: readonly DiscountProductTarget[];
};

export class DiscountDefinitionMalformedError extends Data.TaggedError(
  "DiscountDefinitionMalformedError"
)<{
  readonly discountId: StoredDiscountId;
  readonly message: string;
  readonly cause: unknown;
}> {}

export const decodeDiscountDefinition = Effect.fn("DiscountDefinition.decode")(
  (input: {
    readonly row: DiscountDefinitionRow;
  }): Effect.Effect<DiscountDefinition, DiscountDefinitionMalformedError> =>
    Effect.succeed(input).pipe(
      Effect.let("id", ({ row }) => row.id),
      Effect.bind("label", decodeDefinitionLabel),
      Effect.bind("adjustment", decodeDefinitionAdjustment),
      Effect.bind("targets", decodeDefinitionTargets),
      Effect.let("products", ({ targets }) =>
        targets.map(({ productIdentity }) => productIdentity)
      ),
      Effect.mapError(
        (cause) =>
          new DiscountDefinitionMalformedError({
            discountId: input.row.id,
            message: "Stored discount definition is malformed.",
            cause,
          })
      )
    )
);

const definitionLabelSchema = Schema.Trim.check(Schema.isNonEmpty());

const discountTargetSchema = Schema.Struct({
  discountId: storedDiscountIdSchema,
  productKey: discountProductKeySchema,
  productIdentity: discountProductIdentityCodec,
}).check(
  Schema.makeFilter(
    ({ productIdentity, productKey }) =>
      productKey === `cowork:${productIdentity.tier}` || {
        path: ["productKey"],
        issue: "product key must match the product identity",
      }
  )
);

const discountTargetsSchema = (discountId: StoredDiscountId) =>
  Schema.NonEmptyArray(discountTargetSchema).check(
    Schema.makeFilter(
      (targets) =>
        targets.every((target) => target.discountId === discountId) || {
          path: [],
          issue: "product targets must belong to the discount definition",
        }
    ),
    Schema.makeFilter(
      (targets) =>
        new Set(targets.map(({ productKey }) => productKey)).size ===
          targets.length || {
          path: [],
          issue: "product targets must be unique",
        }
    )
  );

const decodeDefinitionLabel = (input: {
  readonly row: DiscountDefinitionRow;
}) => Schema.decodeUnknownEffect(definitionLabelSchema)(input.row.label);

const decodeDefinitionAdjustment = (input: {
  readonly row: DiscountDefinitionRow;
}) =>
  Schema.decodeUnknownEffect(discountAdjustmentSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(
    input.row.percentageBasisPoints === null
      ? {
          kind: "fixed",
          amount: {
            value: input.row.fixedAmountValue,
            exponent: input.row.fixedAmountExponent,
            currency: input.row.fixedAmountCurrency,
          },
        }
      : {
          kind: "percentage",
          basisPoints: input.row.percentageBasisPoints,
        }
  );

const decodeDefinitionTargets = (input: {
  readonly row: DiscountDefinitionRow;
}) =>
  Schema.decodeUnknownEffect(discountTargetsSchema(input.row.id), {
    errors: "all",
    onExcessProperty: "error",
  })(input.row.productTargets);
