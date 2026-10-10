import type { WorkspaceMoney } from "@/features/checkout/workspace-money";

export const calculateReferrerDiscountAmount = (input: {
  readonly eligibleInviteeCount: number;
  readonly remainingSubtotal: WorkspaceMoney;
}): WorkspaceMoney => {
  const eligibleInviteeCount = BigInt(input.eligibleInviteeCount);
  const denominator = 20n ** eligibleInviteeCount;
  const numerator = denominator - 19n ** eligibleInviteeCount;
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
  const count = BigInt(eligibleInviteeCount);
  if (count === 0n) return "0";

  const denominator = 20n ** count;
  const decimalPlaces = 2n * count;
  const scaledDenominator = 10n ** decimalPlaces;
  const scaledNumerator = (denominator - 19n ** count) * 100n * 5n ** count;
  const whole = scaledNumerator / scaledDenominator;
  const fraction = (scaledNumerator % scaledDenominator)
    .toString()
    .padStart(Number(decimalPlaces), "0")
    .replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
};
