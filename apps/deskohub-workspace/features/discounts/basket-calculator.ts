import { Effect } from "effect";
import { getCanonicalWorkspaceProductIdentity } from "@/features/checkout/product-identity";
import {
  type WorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import { getCanonicalWorkspaceGoodsProductIdentity } from "@/features/goods";
import {
  type CalculatedDiscountApplication,
  calculateDiscounts,
} from "./calculator";
import type {
  DiscountQuote,
  GoodsDiscountBasketLineInput,
  GoodsDiscountBasketQuote,
} from "./contracts";
import { DiscountCalculationError } from "./errors";
import type { GoodsBasketDiscountCandidate } from "./provider";

export type CalculatedGoodsBasketDiscountApplication = {
  readonly candidate: GoodsBasketDiscountCandidate["candidate"];
  readonly lineApplications: readonly {
    readonly lineIndex: number;
    readonly product: GoodsDiscountBasketLineInput["product"];
    readonly application: CalculatedDiscountApplication["application"];
  }[];
};

export type GoodsBasketDiscountCalculation = {
  readonly quote: GoodsDiscountBasketQuote;
  readonly applications: readonly CalculatedGoodsBasketDiscountApplication[];
};

type BasketLineState = {
  readonly input: GoodsDiscountBasketLineInput;
  readonly remaining: WorkspaceMoney;
  readonly applications: readonly CalculatedDiscountApplication["application"][];
};

export const calculateGoodsBasketDiscounts = Effect.fn(
  "DiscountCalculator.calculateGoodsBasket"
)(
  (input: {
    readonly lines: readonly GoodsDiscountBasketLineInput[];
    readonly candidates: readonly GoodsBasketDiscountCandidate[];
  }) =>
    Effect.gen(function* () {
      const firstLine = input.lines[0];
      if (!firstLine) {
        return yield* Effect.fail(
          new DiscountCalculationError({
            reason: "invalid_discountable_subtotal",
            message: "A goods discount basket must contain at least one line.",
          })
        );
      }

      yield* Effect.forEach(input.lines, ({ discountableSubtotal, product }) =>
        calculateDiscounts({
          product,
          discountableSubtotal,
          candidates: [],
        })
      );

      const currency = firstLine.discountableSubtotal.currency;
      const exponent = firstLine.discountableSubtotal.exponent;
      if (
        input.lines.some(
          ({ discountableSubtotal }) =>
            discountableSubtotal.currency !== currency ||
            discountableSubtotal.exponent !== exponent
        )
      ) {
        return yield* Effect.fail(
          new DiscountCalculationError({
            reason: "currency_mismatch",
            message:
              "All goods basket subtotals must use the same currency and exponent.",
          })
        );
      }

      const discountableValueBigInt = input.lines.reduce(
        (sum, line) => sum + BigInt(line.discountableSubtotal.value),
        0n
      );
      if (discountableValueBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        return yield* Effect.fail(
          new DiscountCalculationError({
            reason: "invalid_discountable_subtotal",
            message: "The goods basket subtotal exceeds the safe money range.",
          })
        );
      }

      let lines: readonly BasketLineState[] = input.lines.map((line) => ({
        input: line,
        remaining: line.discountableSubtotal,
        applications: [],
      }));
      const applications: CalculatedGoodsBasketDiscountApplication[] = [];

      for (const selection of input.candidates) {
        const eligibleLineIndexes = [...new Set(selection.eligibleLineIndexes)]
          .filter((index) => index >= 0 && index < lines.length)
          .toSorted((left, right) => left - right);
        const eligibleValue = eligibleLineIndexes.reduce(
          (sum, index) => sum + (lines[index]?.remaining.value ?? 0),
          0
        );
        if (eligibleValue === 0) continue;

        const aggregateSubtotal = workspaceMoneyWithValue(
          eligibleValue,
          firstLine.discountableSubtotal
        );
        const aggregate = yield* calculateDiscounts({
          product: firstLine.product,
          discountableSubtotal: aggregateSubtotal,
          candidates: [selection.candidate],
        });
        const aggregateApplication = aggregate.applications[0];
        if (!aggregateApplication) continue;

        const allocations = allocateProportionally({
          amount: aggregateApplication.application.amount.value,
          lineIndexes: eligibleLineIndexes,
          weights: eligibleLineIndexes.map(
            (index) => lines[index]?.remaining.value ?? 0
          ),
        });
        const lineApplications: CalculatedGoodsBasketDiscountApplication["lineApplications"] =
          allocations.flatMap(({ lineIndex, value }) => {
            if (value === 0) return [];
            const line = lines[lineIndex];
            if (!line) return [];
            const amount = workspaceMoneyWithValue(value, line.remaining);
            const subtotalAfter = workspaceMoneyWithValue(
              line.remaining.value - value,
              line.remaining
            );
            return [
              {
                lineIndex,
                product: getCanonicalWorkspaceGoodsProductIdentity(
                  line.input.product
                ),
                application: {
                  discount: aggregateApplication.application.discount,
                  subtotalBefore: line.remaining,
                  amount,
                  subtotalAfter,
                },
              },
            ];
          });
        const applicationsByLine = new Map(
          lineApplications.map(({ lineIndex, application }) => [
            lineIndex,
            application,
          ])
        );
        lines = lines.map((line, lineIndex) => {
          const application = applicationsByLine.get(lineIndex);
          return application
            ? {
                ...line,
                remaining: application.subtotalAfter,
                applications: [...line.applications, application],
              }
            : line;
        });
        applications.push({
          candidate: selection.candidate,
          lineApplications,
        });
      }

      const discountableValue = Number(discountableValueBigInt);
      const discountedValue = lines.reduce(
        (sum, line) => sum + line.remaining.value,
        0
      );
      const discountableSubtotal = workspaceMoneyWithValue(
        discountableValue,
        firstLine.discountableSubtotal
      );
      const discountedSubtotal = workspaceMoneyWithValue(
        discountedValue,
        firstLine.discountableSubtotal
      );
      const quotes: DiscountQuote[] = lines.map((line) => ({
        product: getCanonicalWorkspaceProductIdentity(line.input.product),
        discountableSubtotal: line.input.discountableSubtotal,
        discounts: line.applications,
        totalDiscount: workspaceMoneyWithValue(
          line.input.discountableSubtotal.value - line.remaining.value,
          line.input.discountableSubtotal
        ),
        discountedSubtotal: line.remaining,
      }));

      return {
        quote: {
          lines: quotes,
          discountableSubtotal,
          totalDiscount: workspaceMoneyWithValue(
            discountableValue - discountedValue,
            firstLine.discountableSubtotal
          ),
          discountedSubtotal,
        },
        applications,
      } satisfies GoodsBasketDiscountCalculation;
    })
);

const allocateProportionally = (input: {
  readonly amount: number;
  readonly lineIndexes: readonly number[];
  readonly weights: readonly number[];
}) => {
  const totalWeight = input.weights.reduce((sum, weight) => sum + weight, 0);
  const allocations = input.lineIndexes.map((lineIndex, index) => {
    const numerator = BigInt(input.amount) * BigInt(input.weights[index] ?? 0);
    return {
      lineIndex,
      value: Number(numerator / BigInt(totalWeight)),
      remainder: numerator % BigInt(totalWeight),
    };
  });
  let remainder =
    input.amount - allocations.reduce((sum, { value }) => sum + value, 0);
  const remainderOrder = allocations
    .map((allocation, index) => ({ ...allocation, index }))
    .toSorted((left, right) => {
      if (right.remainder > left.remainder) return 1;
      if (right.remainder < left.remainder) return -1;
      return left.lineIndex - right.lineIndex;
    });
  for (const allocation of remainderOrder) {
    if (remainder === 0) break;
    const current = allocations[allocation.index];
    if (current) current.value += 1;
    remainder -= 1;
  }
  return allocations;
};
