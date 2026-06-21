import { Data, Effect, Schema } from "effect";
import { z } from "zod/v4";
import type { Locale } from "@/features/i18n";

export type WorkspaceMoney = {
  readonly value: number;
  readonly exponent: number;
  readonly currency: string;
};

export const workspaceMoneySchema = z.object({
  value: z.int(),
  exponent: z.int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const nonNegativeWorkspaceMoneySchema = workspaceMoneySchema.extend({
  value: z.int().nonnegative(),
});

export const positiveWorkspaceMoneyEffectSchema: Schema.Codec<
  WorkspaceMoney,
  WorkspaceMoney
> = Schema.Struct({
  value: Schema.Int.check(Schema.isGreaterThan(0)),
  exponent: Schema.Int.check(Schema.isGreaterThan(0)),
  currency: Schema.String.pipe(
    Schema.check(
      Schema.isPattern(/^[A-Z]{3}$/, {
        description: "ISO 4217 uppercase alphabetic currency code.",
      })
    )
  ),
}).annotate({
  identifier: "PositiveWorkspaceMoney",
  description:
    "Positive workspace money amount stored as a scaled integer value, decimal exponent, and ISO currency code.",
});

export const toWorkspaceMoneyMajorAmount = (money: WorkspaceMoney) =>
  money.value / 10 ** money.exponent;

export function formatWorkspaceMoney(money: WorkspaceMoney, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: money.exponent,
  }).format(toWorkspaceMoneyMajorAmount(money));
}

export const withWorkspaceMoneyCurrency = (
  money: WorkspaceMoney,
  currency: string | undefined
): WorkspaceMoney => ({
  ...money,
  ...(currency && { currency }),
});

export const workspaceMoneyWithValue = (
  value: number,
  template: WorkspaceMoney
): WorkspaceMoney => ({
  value,
  exponent: template.exponent,
  currency: template.currency,
});

export class WorkspaceMoneyError extends Data.TaggedError(
  "WorkspaceMoneyError"
)<{ readonly message: string }> {}

export const addWorkspaceMoneyEffect = Effect.fn("addWorkspaceMoney")(
  function* (amounts: readonly WorkspaceMoney[]) {
    const [first, ...rest] = amounts;
    if (!first) {
      return yield* Effect.fail(
        new WorkspaceMoneyError({
          message: "Cannot total an empty list of workspace money amounts.",
        })
      );
    }

    let total = first;
    for (const amount of rest) {
      if (
        total.currency !== amount.currency ||
        total.exponent !== amount.exponent
      ) {
        return yield* Effect.fail(
          new WorkspaceMoneyError({
            message: "Workspace quote cannot mix currencies or exponents.",
          })
        );
      }

      total = workspaceMoneyWithValue(total.value + amount.value, total);
    }

    return total;
  }
);

export const workspaceMoneyEquals = (
  left: WorkspaceMoney | undefined,
  right: WorkspaceMoney | undefined
) =>
  left?.value === right?.value &&
  left?.currency === right?.currency &&
  left?.exponent === right?.exponent;
