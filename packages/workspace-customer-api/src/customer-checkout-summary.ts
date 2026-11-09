import { Schema } from "effect";
import { Money } from "./customer-account-api";

const isoInstant = Schema.String.annotate({
  description: "ISO 8601 instant.",
});

/** A discount a summary item includes. */
export const CustomerCheckoutSummaryDiscount = Schema.Struct({
  discount: Schema.Struct({
    id: Schema.String,
    /** The discount's name, in the request's language. */
    label: Schema.String,
    /** When the discount stops applying, while it has an end. */
    expiresAt: Schema.optionalKey(isoInstant),
    /** When to start counting down to `expiresAt`. */
    countdownStartsAt: Schema.optionalKey(isoInstant),
  }),
  /** What the discount takes off the item. */
  amount: Money,
}).annotate({ identifier: "CustomerCheckoutSummaryDiscount" });
export type CustomerCheckoutSummaryDiscount =
  typeof CustomerCheckoutSummaryDiscount.Type;

/** One line of a checkout summary. */
export const CustomerCheckoutSummaryItem = Schema.Struct({
  /**
   * What the line is: `product:<product key>`, `addon:coffee`,
   * `addon:workstation`, `monitor:<option>`, or `total:final`.
   */
  key: Schema.String,
  /** The line's price after its discounts. */
  amount: Money,
  /** The price before discounts, on a discounted product line. */
  originalAmount: Schema.optionalKey(Money),
  discounts: Schema.optionalKey(Schema.Array(CustomerCheckoutSummaryDiscount)),
  /** Office product line only: the days booked. */
  dayCount: Schema.optionalKey(Schema.Int),
  /** Office product line only: the seats booked. */
  seats: Schema.optionalKey(Schema.Int),
  /** Office product line only: the office access part of `amount`. */
  accessAmount: Schema.optionalKey(Money),
  /**
   * Office product line only: one seat's price for the days booked. The
   * seats' part of `amount` is this times `seats`.
   */
  seatAmount: Schema.optionalKey(Money),
}).annotate({ identifier: "CustomerCheckoutSummaryItem" });
export type CustomerCheckoutSummaryItem =
  typeof CustomerCheckoutSummaryItem.Type;

/**
 * The itemized price of a booking, as the booking pages show it: the order's
 * lines, then the total.
 */
export const CustomerCheckoutSummary = Schema.Struct({
  sections: Schema.Array(
    Schema.Struct({
      key: Schema.Literals(["order", "total"]),
      items: Schema.Array(CustomerCheckoutSummaryItem),
      total: Money,
    })
  ),
  total: Money,
}).annotate({ identifier: "CustomerCheckoutSummary" });
export type CustomerCheckoutSummary = typeof CustomerCheckoutSummary.Type;
