import { Effect, Schema } from "effect";
import {
  getWorkspaceOfficeAccessPrice,
  getWorkspaceOfficePrice,
  getWorkspaceOfficeSeatPrice,
} from "@/features/checkout/product-catalog";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { makeReservationQuoteSchema } from "@/features/checkout/reservation-quote-schema";
import {
  positiveWorkspaceMoneyCodec,
  workspaceMoneyCodec,
} from "@/features/checkout/workspace-money";
import type { DiscountQuote } from "@/features/discounts/contracts";
import {
  getOfficeReservationDayCount,
  type OfficeReservationPricingInput,
  officeAdditionalGuestsSchema,
} from "@/features/reservation/office-reservation";

export const officeReservationQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("office"),
  dayCount: Schema.Int.check(Schema.isGreaterThan(0)),
  additionalGuests: officeAdditionalGuestsSchema,
  accessAmount: positiveWorkspaceMoneyCodec,
  seatAmount: positiveWorkspaceMoneyCodec,
  amount: workspaceMoneyCodec,
});

export type OfficeReservationQuoteItem =
  typeof officeReservationQuoteItemSchema.Type;

export const officeReservationQuoteSchema = makeReservationQuoteSchema(
  Schema.Tuple([officeReservationQuoteItemSchema])
);

export type OfficeReservationQuote = typeof officeReservationQuoteSchema.Type;

export type CanonicalOfficeReservation = {
  readonly kind: "office";
  readonly startsOn: OfficeReservationPricingInput["startsOn"];
  readonly endsOn: OfficeReservationPricingInput["endsOn"];
  readonly additionalGuests: OfficeReservationPricingInput["additionalGuests"];
};

export const getOfficeReservationQuote = (
  reservation: OfficeReservationPricingInput,
  options: { readonly discountQuote?: DiscountQuote } = {}
) => {
  const dayCount = getOfficeReservationDayCount(reservation);
  const amount = getWorkspaceOfficePrice({
    additionalGuests: reservation.additionalGuests,
    dayCount,
  });
  const accessAmount = getWorkspaceOfficeAccessPrice(dayCount);
  const seatAmount = getWorkspaceOfficeSeatPrice(dayCount);
  const discounts = options.discountQuote?.discounts ?? [];
  const expectedPrice = options.discountQuote?.discountedSubtotal ?? amount;

  return Effect.succeed({
    items: [
      {
        type: "office" as const,
        dayCount,
        additionalGuests: reservation.additionalGuests,
        accessAmount,
        seatAmount,
        amount,
      },
    ] as const,
    payment: {
      expectedPrice,
      undiscountedPrice: amount,
      discounts,
    },
  });
};

export const buildOfficeReservationQuote = Effect.fn(
  "buildOfficeReservationQuote"
)(function* (
  reservation: OfficeReservationPricingInput,
  options: { readonly discountQuote?: DiscountQuote } = {}
) {
  const quoteWithoutFingerprint = yield* getOfficeReservationQuote(
    reservation,
    options
  );

  return {
    ...quoteWithoutFingerprint,
    fingerprint: getReservationQuoteFingerprint(
      reservation,
      quoteWithoutFingerprint
    ),
  };
});

export const getCanonicalOfficeReservation = (
  reservation: OfficeReservationPricingInput
): CanonicalOfficeReservation => ({
  kind: "office",
  startsOn: reservation.startsOn,
  endsOn: reservation.endsOn,
  additionalGuests: reservation.additionalGuests,
});
