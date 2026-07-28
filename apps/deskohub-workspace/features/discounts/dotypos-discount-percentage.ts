import type { DiscountGroup } from "@deskohub/dotypos/generated";
import { BigDecimal, Option, Schema, SchemaGetter } from "effect";
import { discountBasisPointsSchema } from "./contracts";

const dotyposDiscountBasisPointsSchema = Schema.String.check(
  Schema.isPattern(/^\d+(?:\.\d+)?$/)
)
  .pipe(
    Schema.decodeTo(
      Schema.BigDecimalFromString.check(
        Schema.isBetweenBigDecimal({
          minimum: BigDecimal.fromBigInt(BigInt(0)),
          maximum: BigDecimal.fromBigInt(BigInt(100)),
          exclusiveMinimum: true,
        }),
        Schema.makeFilter(
          (percentage) =>
            BigDecimal.isInteger(
              BigDecimal.multiply(
                percentage,
                BigDecimal.fromBigInt(BigInt(100))
              )
            ),
          { message: "must convert exactly to whole basis points" }
        )
      )
    ),
    Schema.decodeTo(discountBasisPointsSchema, {
      decode: SchemaGetter.transform((percentage) =>
        Number(
          BigDecimal.scale(
            BigDecimal.multiply(percentage, BigDecimal.fromBigInt(BigInt(100))),
            0
          ).value
        )
      ),
      encode: SchemaGetter.transform((basisPoints) =>
        BigDecimal.make(BigInt(basisPoints), 2)
      ),
    })
  )
  .annotate({
    identifier: "DotyposDiscountBasisPoints",
    description:
      "A Dotypos decimal percentage decoded exactly into whole basis points.",
  });

export const toDotyposDiscountBasisPoints = (
  input: DiscountGroup["discountPercent"]
) =>
  Option.fromNullishOr(input).pipe(
    Option.map((percentage) => percentage.trim()),
    Option.flatMap(
      Schema.decodeUnknownOption(dotyposDiscountBasisPointsSchema)
    ),
    Option.getOrUndefined
  );
