import { Effect, Schema } from "effect";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import type { DiscountQuote } from "@/features/discounts";
import { discountIdSchema } from "@/features/discounts/contracts";
import { coworkReservationProductSchema } from "@/features/reservation/cowork-reservation-product";
import {
  buildCoworkReservationQuote as buildCoworkReservationQuoteEffect,
  type CoworkReservationQuote,
} from "./reservation-quote-cowork";

export type CoworkReservationQuoteOrder =
  typeof coworkReservationProductSchema.Encoded;

const decodeCoworkReservationProduct = Schema.decodeUnknownSync(
  coworkReservationProductSchema
);

const getNormalizedCoworkReservation = (
  order: CoworkReservationQuoteOrder
) => ({
  kind: "cowork" as const,
  ...decodeCoworkReservationProduct(order),
  date: "2099-01-01",
});

export const buildCoworkReservationQuote = (
  order: CoworkReservationQuoteOrder,
  options: {
    readonly discountQuote?: DiscountQuote;
  } = {}
): CoworkReservationQuote => {
  const reservation = getNormalizedCoworkReservation(order);
  return Effect.runSync(
    buildCoworkReservationQuoteEffect(reservation, options)
  );
};

export const buildCoworkCheckoutSummary = (
  order: CoworkReservationQuoteOrder,
  options: {
    readonly discountQuote?: DiscountQuote;
  } = {}
) => {
  const reservation = getNormalizedCoworkReservation(order);
  return getCoworkCheckoutSummary(
    reservation,
    buildCoworkReservationQuote(order, options)
  );
};

export const buildDiscountedCoworkCheckoutSummary = ({
  basisPoints = 5000,
  countdownStartsAt,
  expiresAt,
}: {
  readonly basisPoints?: number;
  readonly countdownStartsAt?: string;
  readonly expiresAt?: string;
}) => {
  const money = (value: number) => ({
    value,
    exponent: 2,
    currency: "CZK",
  });
  const discountAmount = 35_000 * (basisPoints / 10_000);

  return buildCoworkCheckoutSummary(
    { entryTier: "basic", coffee: false },
    {
      discountQuote: {
        product: { kind: "cowork", tier: "basic" },
        discountableSubtotal: money(35_000),
        discounts: [
          {
            discount: {
              id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
              label: "Summer sale",
              adjustment: { kind: "percentage", basisPoints },
              ...(countdownStartsAt && { countdownStartsAt }),
              ...(expiresAt && { expiresAt }),
            },
            subtotalBefore: money(35_000),
            amount: money(discountAmount),
            subtotalAfter: money(35_000 - discountAmount),
          },
        ],
        totalDiscount: money(discountAmount),
        discountedSubtotal: money(35_000 - discountAmount),
      },
    }
  );
};
