import { NexiAmountSchema, nexiMinorUnitExponent } from "@deskohub/nexi";
import { Effect, Option, Schema, SchemaGetter, SchemaIssue } from "effect";
import { positiveMoneyCodec } from "@/shared/money/money";

const invalidValue = <T>(actual: T, message: string) =>
  new SchemaIssue.InvalidValue(Option.some(actual), { message });

export const NexiAmountFromWorkspaceMoney = NexiAmountSchema.pipe(
  Schema.decodeTo(positiveMoneyCodec, {
    decode: SchemaGetter.transformOrFail((nexiAmount, options) =>
      Schema.decodeUnknownEffect(positiveMoneyCodec)(
        {
          value: Number(nexiAmount.amount),
          exponent: nexiMinorUnitExponent,
          currency: nexiAmount.currency,
        },
        options
      ).pipe(
        Effect.mapError((error) => invalidValue(nexiAmount, error.message))
      )
    ),
    encode: SchemaGetter.transformOrFail((money, options) =>
      Schema.decodeUnknownEffect(NexiAmountSchema)(
        {
          amount: (
            money.value *
            10 ** (nexiMinorUnitExponent - money.exponent)
          ).toString(),
          currency: money.currency,
        },
        options
      ).pipe(Effect.mapError((error) => invalidValue(money, error.message)))
    ) as SchemaGetter.Getter<
      typeof NexiAmountSchema.Encoded,
      typeof positiveMoneyCodec.Encoded
    >,
  })
).annotate({
  identifier: "NexiAmountFromWorkspaceMoney",
  description:
    "Codec between Money and Nexi's integer minor-unit amount shape with ISO 4217 currency.",
});
