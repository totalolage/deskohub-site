import { NexiAmountSchema, nexiMinorUnitExponent } from "@deskohub/nexi";
import { Effect, ParseResult, Schema } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/product-catalog";

export const WorkspaceMoneySchema: Schema.Schema<WorkspaceMoney> =
  Schema.Struct({
    value: Schema.Number.pipe(Schema.int(), Schema.positive()),
    exponent: Schema.Number.pipe(Schema.int(), Schema.positive()),
    currency: Schema.String.pipe(
      Schema.pattern(/^[A-Z]{3}$/, {
        description: "ISO 4217 uppercase alphabetic currency code.",
      })
    ),
  }).annotations({
    identifier: "WorkspaceMoney",
    description:
      "Workspace money amount stored as a scaled integer value, decimal exponent, and ISO currency code.",
  });

export const NexiAmountFromWorkspaceMoney = Schema.transformOrFail(
  NexiAmountSchema,
  WorkspaceMoneySchema,
  {
    strict: true,
    decode: (nexiAmount, options, ast) =>
      Schema.decode(WorkspaceMoneySchema)(
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
