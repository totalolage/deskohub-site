import { Effect, Match, Option, Schema } from "effect";
import {
  getCanonicalWorkspaceProductIdentity,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import {
  type Money,
  moneyEquals,
  moneyWithValue,
  nonNegativeMoneyCodec,
  sameMoneyUnit,
} from "@/shared/money/money";
import type { AppliedDiscount, Discount, DiscountQuote } from "./contracts";
import { DiscountCalculationError } from "./errors";
import type { DiscountCandidate } from "./provider";
import { recoverDiscountResolution } from "./resolution-logging";

type DiscountCalculationInput = {
  readonly product: WorkspaceProductIdentity;
  readonly discountableSubtotal: Money;
  readonly candidates: readonly DiscountCandidate[];
};

export type CalculatedDiscountApplication = {
  readonly candidate: DiscountCandidate;
  readonly application: AppliedDiscount;
};

export type DiscountCalculation = {
  readonly quote: DiscountQuote;
  readonly applications: readonly CalculatedDiscountApplication[];
};

type DiscountCalculationState = {
  readonly candidates: readonly DiscountCandidate[];
  readonly index: number;
  readonly remaining: Money;
  readonly applications: readonly CalculatedDiscountApplication[];
};

export const calculateDiscounts = Effect.fn("DiscountCalculator.calculate")(
  (input: DiscountCalculationInput) =>
    Effect.succeed(input).pipe(
      Effect.bind("validatedSubtotal", validateDiscountableSubtotal),
      Effect.bind("calculation", calculateApplications),
      Effect.map(toDiscountCalculation)
    )
);

/**
 * Calculates candidates on the quote's remaining subtotal and appends them,
 * returning the extended quote and the new applications.
 */
export const appendDiscountCalculation = Effect.fn(
  "DiscountCalculator.appendCalculation"
)(
  (input: {
    readonly baseQuote: DiscountQuote;
    readonly candidates: readonly DiscountCandidate[];
  }) =>
    calculateDiscounts({
      product: input.baseQuote.product,
      discountableSubtotal: input.baseQuote.discountedSubtotal,
      candidates: input.candidates,
    }).pipe(
      Effect.map(
        (additional): DiscountCalculation => ({
          quote: {
            product: input.baseQuote.product,
            discountableSubtotal: input.baseQuote.discountableSubtotal,
            discounts: [
              ...input.baseQuote.discounts,
              ...additional.quote.discounts,
            ],
            totalDiscount: moneyWithValue(
              input.baseQuote.totalDiscount.value +
                additional.quote.totalDiscount.value,
              input.baseQuote.totalDiscount
            ),
            discountedSubtotal: additional.quote.discountedSubtotal,
          },
          applications: additional.applications,
        })
      )
    )
);

export const appendDiscounts = Effect.fn("DiscountCalculator.append")(
  (input: {
    readonly baseQuote: DiscountQuote;
    readonly candidates: readonly DiscountCandidate[];
  }) => appendDiscountCalculation(input).pipe(Effect.map(({ quote }) => quote))
);

const validateDiscountableSubtotal = (input: {
  readonly discountableSubtotal: Money;
}) =>
  Schema.decodeEffect(nonNegativeMoneyCodec)(input.discountableSubtotal).pipe(
    Effect.mapError(
      (cause) =>
        new DiscountCalculationError({
          reason: "invalid_discountable_subtotal",
          message:
            "Discountable subtotal must be non-negative integer money with a valid exponent and currency.",
          cause,
        })
    )
  );

const calculateApplications = (input: {
  readonly candidates: readonly DiscountCandidate[];
  readonly validatedSubtotal: Money;
}) =>
  applyNextCandidate({
    nextState: {
      candidates: input.candidates,
      index: 0,
      remaining: input.validatedSubtotal,
      applications: [],
    },
  });

const applyNextCandidate = (input: {
  readonly nextState: DiscountCalculationState;
}): Effect.Effect<
  Pick<DiscountCalculationState, "applications" | "remaining">,
  DiscountCalculationError
> => {
  const state = input.nextState;
  const candidate = state.candidates[state.index];

  if (!candidate || state.remaining.value === 0) {
    return Effect.succeed({
      remaining: state.remaining,
      applications: state.applications,
    });
  }

  return Effect.succeed({
    state,
    candidate,
    remaining: state.remaining,
  }).pipe(
    Effect.bind("appliedValue", (candidateInput) =>
      recoverDiscountResolution(getAppliedValue(candidateInput), {
        operation: "apply_candidate",
        provider: "calculator",
      })
    ),
    Effect.let("nextState", advanceCalculationState),
    Effect.flatMap(applyNextCandidate)
  );
};

const advanceCalculationState = (input: {
  readonly state: DiscountCalculationState;
  readonly candidate: DiscountCandidate;
  readonly appliedValue: Option.Option<number>;
}): DiscountCalculationState =>
  input.appliedValue.pipe(
    Option.map((appliedValue) =>
      toNextCalculationState({ ...input, appliedValue })
    ),
    Option.getOrElse(() => ({
      ...input.state,
      index: input.state.index + 1,
    }))
  );

const getAppliedValue = (input: {
  readonly candidate: DiscountCandidate;
  readonly remaining: Money;
}) => {
  const { adjustment } = input.candidate.discount;

  return Match.value(adjustment).pipe(
    Match.discriminatorsExhaustive("kind")({
      percentage: (percentageAdjustment) =>
        Effect.succeed(
          Math.min(
            input.remaining.value,
            applyBasisPoints(
              input.remaining.value,
              percentageAdjustment.basisPoints
            )
          )
        ),
      fixed: (fixedAdjustment) => {
        if (fixedAdjustment.amount.currency !== input.remaining.currency) {
          return Effect.fail(
            calculationError(
              "currency_mismatch",
              "Fixed discount currency must match the discountable subtotal.",
              input.candidate.discount
            )
          );
        }

        if (fixedAdjustment.amount.exponent !== input.remaining.exponent) {
          return Effect.fail(
            calculationError(
              "exponent_mismatch",
              "Fixed discount exponent must match the discountable subtotal.",
              input.candidate.discount
            )
          );
        }

        return Effect.succeed(
          Math.min(input.remaining.value, fixedAdjustment.amount.value)
        );
      },
    })
  );
};

const toNextCalculationState = (input: {
  readonly state: DiscountCalculationState;
  readonly candidate: DiscountCandidate;
  readonly appliedValue: number;
}): DiscountCalculationState => {
  const amount = moneyWithValue(input.appliedValue, input.state.remaining);
  const subtotalAfter = moneyWithValue(
    input.state.remaining.value - input.appliedValue,
    input.state.remaining
  );
  const discount = toPublicDiscount(input.candidate.discount);

  return {
    ...input.state,
    index: input.state.index + 1,
    remaining: subtotalAfter,
    applications:
      input.appliedValue === 0
        ? input.state.applications
        : [
            ...input.state.applications,
            {
              candidate: input.candidate,
              application: {
                discount,
                subtotalBefore: input.state.remaining,
                amount,
                subtotalAfter,
              },
            },
          ],
  };
};

const toDiscountCalculation = (input: {
  readonly product: WorkspaceProductIdentity;
  readonly validatedSubtotal: Money;
  readonly calculation: Pick<
    DiscountCalculationState,
    "applications" | "remaining"
  >;
}): DiscountCalculation => ({
  quote: {
    product: getCanonicalWorkspaceProductIdentity(input.product),
    discountableSubtotal: input.validatedSubtotal,
    discounts: input.calculation.applications.map(
      ({ application }) => application
    ),
    totalDiscount: moneyWithValue(
      input.validatedSubtotal.value - input.calculation.remaining.value,
      input.validatedSubtotal
    ),
    discountedSubtotal: input.calculation.remaining,
  },
  applications: input.calculation.applications,
});

const calculationError = (
  reason: DiscountCalculationError["reason"],
  message: string,
  discount: Discount
) =>
  new DiscountCalculationError({
    reason,
    message,
    discountId: discount.id,
  });

const toPublicDiscount = (discount: Discount): Discount => ({
  id: discount.id,
  label: discount.label,
  adjustment: Match.value(discount.adjustment).pipe(
    Match.discriminatorsExhaustive("kind")({
      percentage: (adjustment) => ({
        kind: adjustment.kind,
        basisPoints: adjustment.basisPoints,
      }),
      fixed: (adjustment) => ({
        kind: adjustment.kind,
        amount: {
          value: adjustment.amount.value,
          exponent: adjustment.amount.exponent,
          currency: adjustment.amount.currency,
        },
      }),
    })
  ),
  ...(discount.expiresAt !== undefined && { expiresAt: discount.expiresAt }),
  ...(discount.countdownStartsAt !== undefined && {
    countdownStartsAt: discount.countdownStartsAt,
  }),
});

/** The share of a minor-unit value, rounded half up to a whole minor unit. */
export const applyBasisPoints = (value: number, basisPoints: number) =>
  Number((BigInt(value) * BigInt(basisPoints) + BigInt(5000)) / BigInt(10_000));

/**
 * Whether an application takes no more than its subtotal, in the subtotal's
 * unit, and leaves exactly the difference.
 */
export const isApplicationArithmeticConsistent = (
  application: AppliedDiscount
) => {
  const { subtotalBefore, amount, subtotalAfter } = application;
  return (
    sameMoneyUnit(subtotalBefore, amount) &&
    subtotalBefore.value >= amount.value &&
    moneyEquals(subtotalAfter, {
      ...subtotalBefore,
      value: subtotalBefore.value - amount.value,
    })
  );
};
