import { Effect } from "effect";

type DiscountResolutionFailure = {
  readonly _tag: string;
  readonly reason: string;
};

export type DiscountResolutionProvider =
  | "calendar"
  | "customer"
  | "code"
  | "calculator";

export type DiscountResolutionOperation =
  | "quote"
  | "affirm"
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
  fallback: A,
  input: {
    readonly operation: DiscountResolutionOperation;
    readonly provider: DiscountResolutionProvider;
  }
): Effect.Effect<A> =>
  effect.pipe(
    Effect.catch((cause) =>
      logDiscountResolutionFailure({ ...input, cause }).pipe(
        Effect.as(fallback)
      )
    )
  );
