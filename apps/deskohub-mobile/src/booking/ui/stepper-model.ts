export interface StepperModel {
  readonly canDecrement: boolean;
  readonly canIncrement: boolean;
  /** `value` brought into `min..max`; `min` when the range is empty. */
  readonly clamp: (value: number) => number;
}

/**
 * Whether a stepper at `value` can step down or up by one within
 * `min..max`. A `max` below `min` leaves nothing to choose, so neither
 * step is possible.
 */
export const stepperModel = ({
  value,
  min,
  max,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
}): StepperModel => {
  const hasChoices = max >= min;
  return {
    canDecrement: hasChoices && value > min,
    canIncrement: hasChoices && value < max,
    clamp: (next) => Math.max(min, Math.min(max, next)),
  };
};
