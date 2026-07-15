import { Data, Effect, Schema } from "effect";
import type { DiscountAdjustment, DiscountProductIdentity } from "./contracts";
import {
  discountAdjustmentEffectSchema,
  discountProductIdentityEffectSchema,
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

export type DiscountDefinitionRow = {
  readonly id: unknown;
  readonly label: unknown;
  readonly percentageBasisPoints: unknown;
  readonly fixedAmountValue: unknown;
  readonly fixedAmountExponent: unknown;
  readonly fixedAmountCurrency: unknown;
  readonly productTargets: readonly {
    readonly productKey: unknown;
    readonly productIdentity: unknown;
  }[];
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
    readonly discountId: StoredDiscountId;
    readonly row: DiscountDefinitionRow;
  }): Effect.Effect<DiscountDefinition, DiscountDefinitionMalformedError> =>
    Effect.succeed(input).pipe(
      Effect.bind("id", decodeDefinitionId),
      Effect.bind("label", decodeDefinitionLabel),
      Effect.bind("adjustment", decodeDefinitionAdjustment),
      Effect.bind("targets", decodeDefinitionTargets),
      Effect.let("products", ({ targets }) =>
        targets.map(({ productIdentity }) => productIdentity)
      ),
      Effect.mapError(
        (cause) =>
          new DiscountDefinitionMalformedError({
            discountId: input.discountId,
            message: "Stored discount definition is malformed.",
            cause,
          })
      )
    )
);

const definitionLabelSchema = Schema.Trim.check(Schema.isNonEmpty());

const discountTargetSchema = Schema.Struct({
  productKey: discountProductKeySchema,
  productIdentity: discountProductIdentityEffectSchema,
}).check(
  Schema.makeFilter(
    ({ productIdentity, productKey }) =>
      productKey === `cowork:${productIdentity.tier}` || {
        path: ["productKey"],
        issue: "product key must match the product identity",
      }
  )
);

const discountTargetsSchema = Schema.NonEmptyArray(discountTargetSchema).check(
  Schema.makeFilter(
    (targets) =>
      new Set(targets.map(({ productKey }) => productKey)).size ===
        targets.length || {
        path: [],
        issue: "product targets must be unique",
      }
  )
);

const decodeDefinitionId = (input: { readonly row: DiscountDefinitionRow }) =>
  Schema.decodeUnknownEffect(storedDiscountIdSchema)(input.row.id);

const decodeDefinitionLabel = (input: {
  readonly row: DiscountDefinitionRow;
}) => Schema.decodeUnknownEffect(definitionLabelSchema)(input.row.label);

const decodeDefinitionAdjustment = (input: {
  readonly row: DiscountDefinitionRow;
}) =>
  Schema.decodeUnknownEffect(discountAdjustmentEffectSchema, {
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
  Schema.decodeUnknownEffect(discountTargetsSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input.row.productTargets);
