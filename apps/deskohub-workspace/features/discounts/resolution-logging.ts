import { Effect, Match, type Option } from "effect";
import type { ReferralOutage } from "@/features/referrals/contracts";
import type { CalendarSaleConfigurationError } from "./calendar-sale";
import type { DiscountResolutionError } from "./errors";

export type DiscountResolutionFailure =
  | CalendarSaleConfigurationError
  | ReferralOutage
  | DiscountResolutionError;

/** A low-cardinality reason; a failed database statement has none of its own. */
const getFailureReason = Match.type<DiscountResolutionFailure>().pipe(
  Match.tagsExhaustive({
    CalendarSaleConfigurationError: ({ reason }) => reason,
    DiscountCalculationError: ({ reason }) => reason,
    PromotionCodeUnavailableError: ({ reason }) => reason,
    DiscountProviderError: ({ reason }) => reason,
    DotyposUnavailable: ({ reason }) => reason,
    DotyposRejected: ({ reason }) => reason,
    EffectDrizzleQueryError: () => "database",
    SqlError: () => "database",
  })
);

export type DiscountResolutionProvider =
  | "calendar"
  | "customer"
  | "code"
  | "referral"
  | "calculator";

export type DiscountResolutionOperation =
  | "quote"
  | "discover_active_sales"
  | "discover_advertised_discounts"
  | "affirm_advertisement"
  | "apply_customer_discount"
  | "affirm_displayed_discounts"
  | "apply_discount_code"
  | "normalize"
  | "load_definition"
  | "apply_candidate";

export const logDiscountResolutionFailure = (input: {
  readonly cause: DiscountResolutionFailure;
  readonly operation: DiscountResolutionOperation;
  readonly provider: DiscountResolutionProvider;
}) =>
  Effect.logError("Discount provider resolution failed", {
    cause: input.cause,
  }).pipe(
    Effect.annotateLogs({
      discountBoundary: "resolution",
      discountProvider: input.provider,
      discountOperation: input.operation,
      discountErrorTag: input.cause._tag,
      discountErrorReason: getFailureReason(input.cause),
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
