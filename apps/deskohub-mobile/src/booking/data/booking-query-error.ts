import type {
  CustomerBookingDateOutOfRange,
  CustomerBookingSelectionInvalid,
  CustomerOfferingUnavailable,
} from "@deskohub/workspace-customer-api";
import { Data, Match } from "effect";
import {
  type CustomerRequestFailure,
  type CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";

/** Every failure a booking catalog read can end in. */
export type BookingQueryFailure =
  | CustomerRequestFailure
  | CustomerBookingSelectionInvalid
  | CustomerBookingDateOutOfRange
  | CustomerOfferingUnavailable;

/** What a booking screen shows for a catalog failure of its own. */
export type BookingCatalogViewError = Data.TaggedEnum<{
  /** The selection isn't one the product offers; `field` names it when known. */
  SelectionInvalid: { readonly field: string | undefined };
  /** The date can't be booked now; it must lie from `earliest` to `latest`. */
  DateOutOfRange: { readonly earliest: string; readonly latest: string };
  /** The family can't be booked now, such as while offices are closed. */
  OfferingUnavailable: {
    readonly family: CustomerOfferingUnavailable["family"];
  };
}>;

export const BookingCatalogViewError =
  Data.taggedEnum<BookingCatalogViewError>();

/** A booking catalog failure as a screen shows it. */
export type BookingQueryViewError = BookingCatalogViewError | CustomerViewError;

/**
 * Maps a catalog read's failure for a screen: the booking tags here, the
 * shared session, budget and transport ones through `toCustomerViewError`.
 */
export const toBookingQueryError = (
  error: BookingQueryFailure
): BookingQueryViewError =>
  Match.value(error).pipe(
    Match.tag("CustomerBookingSelectionInvalid", ({ field }) =>
      BookingCatalogViewError.SelectionInvalid({ field })
    ),
    Match.tag("CustomerBookingDateOutOfRange", ({ earliest, latest }) =>
      BookingCatalogViewError.DateOutOfRange({ earliest, latest })
    ),
    Match.tag("CustomerOfferingUnavailable", ({ family }) =>
      BookingCatalogViewError.OfferingUnavailable({ family })
    ),
    // The rest is exactly `CustomerRequestFailure`, which it maps exhaustively.
    Match.orElse(toCustomerViewError)
  );
