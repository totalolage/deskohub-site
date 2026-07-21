import { Effect, type Option } from "effect";
import type { CalendarSaleConfigurationError } from "./calendar-sale";
import type { DiscountResolutionError } from "./errors";

export type DiscountResolutionFailure =
  | CalendarSaleConfigurationError
  | DiscountResolutionError;

export type DiscountResolutionProvider =
  | "calendar"
  | "customer"
  | "code"
  | "calculator";

export type DiscountResolutionOperation =
  | "discover_advertised_discounts"
  | "affirm_advertisement"
  | "quote_for_customer"
  | "affirm_for_payment"
  | "normalize"
  | "load_definition"
  | "apply_candidate";

export const logDiscountResolutionFailure = (input: {
  readonly cause: DiscountResolutionFailure;
  readonly operation: DiscountResolutionOperation;
  readonly provider: DiscountResolutionProvider;
}) =>
  Effect.logError("Discount provider resolution failed").pipe(
    Effect.annotateLogs({
      discountBoundary: "resolution",
      discountProvider: input.provider,
      discountOperation: input.operation,
      discountErrorTag: input.cause._tag,
      discountErrorReason: input.cause.reason,
    })
  );

export const recoverDiscountResolution = <
  A,
  E extends DiscountResolutionFailure,
>(
  effect: Effect.Effect<A, E>,
  input: {
    readonly operation: DiscountResolutionOperation;
    readonly provider: DiscountResolutionProvider;
  }
): Effect.Effect<Option.Option<A>> =>
  effect.pipe(
    Effect.tapError((cause) =>
      logDiscountResolutionFailure({ ...input, cause })
    ),
    Effect.option
  );
