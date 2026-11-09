import type { Money } from "@/shared/money/money";
import { referrerDiscountBasisPointsPerInvitee } from "./program";

const basisPointScale = 10_000n;
const remainingBasisPoints =
  basisPointScale - BigInt(referrerDiscountBasisPointsPerInvitee);

/** The exact compounded referrer reduction as a fraction of the price. */
const referrerReduction = (eligibleInviteeCount: number) => {
  const count = BigInt(eligibleInviteeCount);
  const denominator = basisPointScale ** count;
  return {
    numerator: denominator - remainingBasisPoints ** count,
    denominator,
  };
};

export const calculateReferrerDiscountAmount = (input: {
  readonly eligibleInviteeCount: number;
  readonly remainingSubtotal: Money;
}): Money => {
  const { numerator, denominator } = referrerReduction(
    input.eligibleInviteeCount
  );
  const exactMinorUnits = BigInt(input.remainingSubtotal.value) * numerator;
  const roundedMinorUnits =
    (2n * exactMinorUnits + denominator) / (2n * denominator);

  return {
    ...input.remainingSubtotal,
    value: Number(roundedMinorUnits),
  };
};

export const formatReferrerDiscountPercentage = (
  eligibleInviteeCount: number
): string => {
  if (eligibleInviteeCount === 0) return "0";

  // The denominator is a power of ten, so the percentage is an exact decimal.
  const { numerator, denominator } = referrerReduction(eligibleInviteeCount);
  const decimalPlaces = denominator.toString().length - 1 - 2;
  const scale = 10n ** BigInt(decimalPlaces);
  const whole = numerator / scale;
  const fraction = (numerator % scale)
    .toString()
    .padStart(decimalPlaces, "0")
    .replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
};
