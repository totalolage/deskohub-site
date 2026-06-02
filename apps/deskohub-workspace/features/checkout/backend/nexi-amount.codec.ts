import { NexiAmountSchema, nexiMinorUnitExponent } from "@deskohub/nexi";
import { Effect, ParseResult, Schema } from "effect";
import { positiveWorkspaceMoneyEffectSchema } from "@/features/checkout/workspace-money";

export const NexiAmountFromWorkspaceMoney = Schema.transformOrFail(
  NexiAmountSchema,
  positiveWorkspaceMoneyEffectSchema,
  {
    strict: true,
    decode: (nexiAmount, options, ast) =>
      Schema.decode(positiveWorkspaceMoneyEffectSchema)(
        {
          value: Number(nexiAmount.amount),
          exponent: nexiMinorUnitExponent,
          currency: nexiAmount.currency,
        },
        options
      ).pipe(
        Effect.mapError(
          (error) => new ParseResult.Type(ast, nexiAmount, error.message)
        )
      ),
    encode: (money, options, ast) =>
      Schema.decodeUnknown(NexiAmountSchema)(
        {
          amount: (
            money.value *
            10 ** (nexiMinorUnitExponent - money.exponent)
          ).toString(),
          currency: money.currency,
        },
        options
      ).pipe(
        Effect.mapError(
          (error) => new ParseResult.Type(ast, money, error.message)
        )
      ),
  }
).annotations({
  identifier: "NexiAmountFromWorkspaceMoney",
  description:
    "Codec between WorkspaceMoney and Nexi's integer minor-unit amount shape with ISO 4217 currency.",
});
