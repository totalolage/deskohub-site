import { Data, Effect, Schema } from "effect";
import type {
  DiscountLabels,
  DiscountProductTarget,
  StoredDiscount,
} from "@/db/schema";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import { locales } from "@/features/i18n";
import {
  type WorkspaceCoworkProductIdentity,
  workspaceCoworkProductIdentitySchema,
} from "@/features/reservation/cowork-reservation-product";
import { type DiscountAdjustment, discountAdjustmentSchema } from "./contracts";
import {
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "./persistence-contracts";

export type DiscountDefinition = {
  readonly id: StoredDiscountId;
  readonly labels: DiscountLabels;
  readonly adjustment: DiscountAdjustment;
  readonly products: readonly WorkspaceCoworkProductIdentity[];
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
      Effect.bind("labels", decodeDefinitionLabels),
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

const discountLabelsCodec: Schema.Decoder<DiscountLabels> = Schema.Record(
  Schema.Literals(locales),
  definitionLabelSchema
);

const discountTargetSchema: Schema.Decoder<DiscountProductTarget> =
  Schema.Struct({
    discountId: storedDiscountIdSchema,
    productIdentity: workspaceCoworkProductIdentitySchema,
  });

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
        new Set(
          targets.map(({ productIdentity }) =>
            getWorkspaceProductKey(productIdentity)
          )
        ).size === targets.length || {
          path: [],
          issue: "product targets must be unique",
        }
    )
  );

const decodeDefinitionLabels = (input: {
  readonly row: DiscountDefinitionRow;
}) =>
  Schema.decodeUnknownEffect(discountLabelsCodec, {
    errors: "all",
    onExcessProperty: "error",
  })(input.row.labels);

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
