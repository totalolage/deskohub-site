import {
  isPrefilledReservation,
  type PrefilledReservationOptions,
  toPrefilledReservation,
} from "./checkout/prefilled-reservation";
import type { CheckoutData } from "./types";

/**
 * A self-contained in-page function called with its JSON argument, as the
 * expression the argv `wait --fn` and `eval` commands evaluate. It lets an
 * argv caller run the same function a session helper passes to Playwright.
 */
export const inPageCall = <Arg>(fn: (arg: Arg) => unknown, arg: Arg) =>
  `(${fn.toString()})(${JSON.stringify(arg)})`;

/**
 * The argv condition over `isPrefilledReservation`, for callers still on the
 * argv runner.
 */
export const getPrefilledReservationConditionScript = (
  data: CheckoutData,
  options: PrefilledReservationOptions = {}
) => inPageCall(isPrefilledReservation, toPrefilledReservation(data, options));

export const browserTextScript = `
(() => document.body?.innerText ?? '')()
`;
