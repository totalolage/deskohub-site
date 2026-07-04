import { NexiAmountSchema, nexiMinorUnitExponent } from "@deskohub/nexi";
import { Effect, Option, Schema, SchemaGetter, SchemaIssue } from "effect";
import { positiveWorkspaceMoneyEffectSchema } from "@/features/checkout/workspace-money";

const invalidValue = (actual: unknown, message: string) =>
  new SchemaIssue.InvalidValue(Option.some(actual), { message });

export const NexiAmountFromWorkspaceMoney = NexiAmountSchema.pipe(
  Schema.decodeTo(positiveWorkspaceMoneyEffectSchema, {
    decode: SchemaGetter.transformOrFail((nexiAmount, options) =>
      Schema.decodeUnknownEffect(positiveWorkspaceMoneyEffectSchema)(
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
      typeof positiveWorkspaceMoneyEffectSchema.Encoded
    >,
  })
).annotate({
  identifier: "NexiAmountFromWorkspaceMoney",
  description:
    "Codec between WorkspaceMoney and Nexi's integer minor-unit amount shape with ISO 4217 currency.",
});
