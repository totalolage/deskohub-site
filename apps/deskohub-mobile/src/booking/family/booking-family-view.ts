import type {
  CustomerBookingQuote,
  CustomerBookingSelection,
  CustomerLocale,
} from "@deskohub/workspace-customer-api";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  CustomerViewError,
  isRetryableViewError,
} from "../../customer-api/customer-view-error";
import type { CheckoutRestartReason } from "../checkout/booking-problem";
import type { CheckoutRequest } from "../checkout/checkout-flow";
import {
  type BookingQueryFailure,
  type BookingQueryViewError,
  toBookingQueryError,
} from "../data/booking-query-error";

/** One booking catalog read as a selection screen shows it. */
export type BookingRead<A> =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly value: A; readonly refreshing: boolean }
  | {
      readonly kind: "failed";
      readonly error: BookingQueryViewError;
      /** The last value read before the failure, when there was one. */
      readonly value: Option.Option<A>;
      readonly retrying: boolean;
    };

/** The view error of a failed booking read; a defect is unexpected. */
export const bookingQueryErrorOf = (
  cause: Cause.Cause<BookingQueryFailure>
): BookingQueryViewError =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => CustomerViewError.Unexpected(),
    onSome: toBookingQueryError,
  });

export const bookingReadOf = <A>(
  result: AsyncResult.AsyncResult<A, BookingQueryFailure>
): BookingRead<A> => {
  if (AsyncResult.isInitial(result)) return { kind: "loading" };
  if (AsyncResult.isFailure(result)) {
    return {
      kind: "failed",
      error: bookingQueryErrorOf(result.cause),
      value: AsyncResult.value(result),
      retrying: result.waiting,
    };
  }
  return { kind: "loaded", value: result.value, refreshing: result.waiting };
};

/** Whether trying the read again can help; a catalog refusal can't. */
export const isRetryableBookingQueryError = (error: BookingQueryViewError) =>
  !(
    error._tag === "SelectionInvalid" ||
    error._tag === "DateOutOfRange" ||
    error._tag === "OfferingUnavailable"
  ) && isRetryableViewError(error);

/** The read's value once it has one, also while it reloads. */
export const readValue = <A>(read: BookingRead<A>): Option.Option<A> => {
  if (read.kind === "loaded") return Option.some(read.value);
  return read.kind === "failed" ? read.value : Option.none();
};

/**
 * The selection to quote: a complete one whose only blocker, if any, is
 * availability still loading. A selection already known to be unavailable
 * spends no quote read.
 */
export const quotableSelection = (
  selection: Option.Option<CustomerBookingSelection>,
  blockers: ReadonlyArray<{ readonly _tag: string }>
): Option.Option<CustomerBookingSelection> =>
  Option.filter(selection, () =>
    blockers.every((blocker) => blocker._tag === "AvailabilityPending")
  );

/**
 * What Continue hands the checkout: only a complete, available selection
 * with its quote, whose token checkout starts from.
 */
export const checkoutRequestOf = ({
  locale,
  selection,
  blockers,
  quote,
  earlySetup,
}: {
  readonly locale: CustomerLocale;
  readonly selection: Option.Option<CustomerBookingSelection>;
  readonly blockers: ReadonlyArray<unknown>;
  readonly quote: Option.Option<CustomerBookingQuote>;
  /** Meeting room only. */
  readonly earlySetup?: boolean;
}): Option.Option<CheckoutRequest> =>
  blockers.length > 0
    ? Option.none()
    : Option.flatMap(selection, (current) =>
        Option.map(
          Option.filter(quote, ({ family }) => family === current.family),
          ({ advertisedPriceToken }) => ({
            locale,
            selection: current,
            advertisedPriceToken,
            ...(earlySetup === undefined ? {} : { earlySetup }),
          })
        )
      );

const restartReasons: Record<CheckoutRestartReason, true> = {
  hold_expired: true,
  availability_changed: true,
  checkout_conflict: true,
  quote_expired: true,
  offer_replaced: true,
  reservation_ended: true,
  selection_invalid: true,
  date_out_of_range: true,
  offering_unavailable: true,
  checkout_not_found: true,
};

/** The `restart` search parameter a family screen opens with, if valid. */
const isRestartReason = (value: string): value is CheckoutRestartReason =>
  Object.hasOwn(restartReasons, value);

export const restartReasonOf = (
  param: string | ReadonlyArray<string> | undefined
): Option.Option<CheckoutRestartReason> =>
  typeof param === "string" && isRestartReason(param)
    ? Option.some(param)
    : Option.none();

/** The read's value only while it is current: loaded, also when reloading. */
export const loadedValue = <A>(read: BookingRead<A>): Option.Option<A> =>
  read.kind === "loaded" ? Option.some(read.value) : Option.none();

/**
 * The read's value only once it is loaded and not being read again, so a
 * quote refreshed after a restart (or by its timer) is never continued
 * with the token it replaces.
 */
export const freshValue = <A>(read: BookingRead<A>): Option.Option<A> =>
  read.kind === "loaded" && !read.refreshing
    ? Option.some(read.value)
    : Option.none();
