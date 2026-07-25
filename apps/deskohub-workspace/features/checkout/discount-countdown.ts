import type { Discount } from "@/features/discounts/contracts";

const millisecondsPerSecond = 1000;
const millisecondsPerMinute = 60_000;
const millisecondsPerHour = 60 * millisecondsPerMinute;

export type DiscountCountdown = {
  readonly value: number;
  readonly unit: "hour" | "second";
};

export type DiscountCountdownState = {
  readonly countdown?: DiscountCountdown;
  readonly refreshAfterMilliseconds?: number;
};

export const getDiscountCountdownState = (
  discount: Pick<Discount, "countdownStartsAt" | "expiresAt">,
  now: Temporal.Instant
): DiscountCountdownState => {
  if (!(discount.countdownStartsAt && discount.expiresAt)) {
    return {};
  }

  const countdownStartsAt = Temporal.Instant.from(discount.countdownStartsAt);
  const expiresAt = Temporal.Instant.from(discount.expiresAt);

  if (Temporal.Instant.compare(now, countdownStartsAt) < 0) {
    return {
      refreshAfterMilliseconds:
        countdownStartsAt.epochMilliseconds - now.epochMilliseconds,
    };
  }

  if (Temporal.Instant.compare(now, expiresAt) >= 0) {
    return {};
  }

  const remainingMilliseconds =
    expiresAt.epochMilliseconds - now.epochMilliseconds;
  const unit = remainingMilliseconds <= millisecondsPerHour ? "second" : "hour";
  const unitMilliseconds = {
    hour: millisecondsPerHour,
    second: millisecondsPerSecond,
  }[unit];
  const value = Math.max(
    1,
    Math.ceil(remainingMilliseconds / unitMilliseconds)
  );

  return {
    countdown: { value, unit },
    refreshAfterMilliseconds:
      remainingMilliseconds - (value - 1) * unitMilliseconds,
  };
};
