import { Effect, Schema } from "effect";
import {
  nonNegativeWorkspaceMoneyCodec,
  type WorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import {
  type AppliedDiscount,
  type Discount,
  type DiscountProductIdentity,
  type DiscountQuote,
  discountBasisPointsSchema,
} from "./contracts";
import { DiscountCalculationError } from "./errors";
import type { DiscountCandidate } from "./provider";

type DiscountCalculationInput = {
  readonly product: DiscountProductIdentity;
  readonly discountableSubtotal: WorkspaceMoney;
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
  readonly remaining: WorkspaceMoney;
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

const validateDiscountableSubtotal = (input: {
  readonly discountableSubtotal: WorkspaceMoney;
}) =>
  Schema.decodeEffect(nonNegativeWorkspaceMoneyCodec)(
    input.discountableSubtotal
  ).pipe(
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
  readonly validatedSubtotal: WorkspaceMoney;
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
    Effect.bind("appliedValue", getAppliedValue),
    Effect.let("nextState", toNextCalculationState),
    Effect.flatMap(applyNextCandidate)
  );
};

const getAppliedValue = (input: {
  readonly candidate: DiscountCandidate;
  readonly remaining: WorkspaceMoney;
}) => {
  const { adjustment } = input.candidate.discount;

  if (adjustment.kind === "percentage") {
    if (!Schema.is(discountBasisPointsSchema)(adjustment.basisPoints)) {
      return Effect.fail(
        calculationError(
          "invalid_percentage_adjustment",
          "Percentage discounts require integer basis points from 1 through 10,000.",
          input.candidate.discount
        )
      );
    }

    return Effect.succeed(
      Math.min(
        input.remaining.value,
        applyBasisPoints(input.remaining.value, adjustment.basisPoints)
      )
    );
  }

  if (
    !Number.isSafeInteger(adjustment.amount.value) ||
    adjustment.amount.value < 1
  ) {
    return Effect.fail(
      calculationError(
        "invalid_fixed_adjustment",
        "Fixed discounts require a positive integer money amount.",
        input.candidate.discount
      )
    );
  }

  if (adjustment.amount.currency !== input.remaining.currency) {
    return Effect.fail(
      calculationError(
        "currency_mismatch",
        "Fixed discount currency must match the discountable subtotal.",
        input.candidate.discount
      )
    );
  }

  if (adjustment.amount.exponent !== input.remaining.exponent) {
    return Effect.fail(
      calculationError(
        "exponent_mismatch",
        "Fixed discount exponent must match the discountable subtotal.",
        input.candidate.discount
      )
    );
  }

  return Effect.succeed(
    Math.min(input.remaining.value, adjustment.amount.value)
  );
};

const toNextCalculationState = (input: {
  readonly state: DiscountCalculationState;
  readonly candidate: DiscountCandidate;
  readonly appliedValue: number;
}): DiscountCalculationState => {
  const amount = workspaceMoneyWithValue(
    input.appliedValue,
    input.state.remaining
  );
  const subtotalAfter = workspaceMoneyWithValue(
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
  readonly product: DiscountProductIdentity;
  readonly validatedSubtotal: WorkspaceMoney;
  readonly calculation: Pick<
    DiscountCalculationState,
    "applications" | "remaining"
  >;
}): DiscountCalculation => ({
  quote: {
    product: { kind: "cowork", tier: input.product.tier },
    discountableSubtotal: input.validatedSubtotal,
    discounts: input.calculation.applications.map(
      ({ application }) => application
    ),
    totalDiscount: workspaceMoneyWithValue(
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
  adjustment:
    discount.adjustment.kind === "percentage"
      ? {
          kind: "percentage",
          basisPoints: discount.adjustment.basisPoints,
        }
      : {
          kind: "fixed",
          amount: {
            value: discount.adjustment.amount.value,
            exponent: discount.adjustment.amount.exponent,
            currency: discount.adjustment.amount.currency,
          },
        },
  ...(discount.expiresAt !== undefined && { expiresAt: discount.expiresAt }),
  ...(discount.countdownStartsAt !== undefined && {
    countdownStartsAt: discount.countdownStartsAt,
  }),
});

const applyBasisPoints = (value: number, basisPoints: number) =>
  Number((BigInt(value) * BigInt(basisPoints) + BigInt(5000)) / BigInt(10_000));
