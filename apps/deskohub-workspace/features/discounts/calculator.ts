import { Effect, Match, Option, Schema } from "effect";
import {
  nonNegativeWorkspaceMoneyCodec,
  type WorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import type { WorkspaceCoworkProductIdentity } from "@/features/reservation/cowork-reservation-product";
import type { AppliedDiscount, Discount, DiscountQuote } from "./contracts";
import { DiscountCalculationError } from "./errors";
import type { DiscountCandidate } from "./provider";
import { recoverDiscountResolution } from "./resolution-logging";

type DiscountCalculationInput = {
  readonly product: WorkspaceCoworkProductIdentity;
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

export const appendDiscounts = Effect.fn("DiscountCalculator.append")(
  (input: {
    readonly baseQuote: DiscountQuote;
    readonly candidates: readonly DiscountCandidate[];
  }) =>
    calculateDiscounts({
      product: input.baseQuote.product,
      discountableSubtotal: input.baseQuote.discountedSubtotal,
      candidates: input.candidates,
    }).pipe(
      Effect.bindTo("additional"),
      Effect.let("totalDiscount", ({ additional }) =>
        workspaceMoneyWithValue(
          input.baseQuote.totalDiscount.value +
            additional.quote.totalDiscount.value,
          input.baseQuote.totalDiscount
        )
      ),
      Effect.map(
        ({ additional, totalDiscount }): DiscountQuote => ({
          product: input.baseQuote.product,
          discountableSubtotal: input.baseQuote.discountableSubtotal,
          discounts: [
            ...input.baseQuote.discounts,
            ...additional.quote.discounts,
          ],
          totalDiscount,
          discountedSubtotal: additional.quote.discountedSubtotal,
        })
      )
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
  readonly remaining: WorkspaceMoney;
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
  readonly product: WorkspaceCoworkProductIdentity;
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

const applyBasisPoints = (value: number, basisPoints: number) =>
  Number((BigInt(value) * BigInt(basisPoints) + BigInt(5000)) / BigInt(10_000));
