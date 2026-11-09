import type {
  CustomerOffering,
  CustomerReservationFamily,
  Money,
} from "@deskohub/workspace-customer-api";
import { Array as Arr } from "effect";

/** One family the chooser offers, at the lowest price it advertises today. */
export type BookingFamilyChoice = {
  readonly family: CustomerReservationFamily;
  /** The lowest advertised price among the family's offerings. */
  readonly fromPrice: Money;
};

const cheaper = (left: Money, right: Money) =>
  right.value * 10 ** (left.exponent - right.exponent) < left.value
    ? right
    : left;

/**
 * The families to book, in catalog order, each with the advertised "from"
 * price of its cheapest offering: a cowork tier, a meeting-room duration, or
 * one office day with one seat.
 */
export const bookingFamilyChoices = (
  offerings: ReadonlyArray<CustomerOffering>
): ReadonlyArray<BookingFamilyChoice> =>
  Object.values(Arr.groupBy(offerings, ({ family }) => family)).map((group) => {
    const prices = Arr.map(
      group,
      ({ advertisedPrice }) => advertisedPrice.price
    );
    return {
      family: Arr.headNonEmpty(group).family,
      fromPrice: Arr.reduce(
        Arr.tailNonEmpty(prices),
        Arr.headNonEmpty(prices),
        cheaper
      ),
    };
  });
