import {
  type CoworkReservationQuote,
  coworkReservationQuoteSchema,
} from "@/features/checkout/checkout-quote";
import {
  type NormalizedCoworkReservationOrder,
  normalizeCoworkReservationOrder,
  normalizedCoworkReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";
import {
  type BuildSignedReservationPayStateInput,
  buildSignedReservationPayState,
  makeSignedReservationPayStateSchema,
  type SignedPayStateClaims,
} from "./reservation-pay-state";

export const coworkSignedPayStateSchema = makeSignedReservationPayStateSchema({
  reservation: normalizedCoworkReservationOrderSchema,
  quote: coworkReservationQuoteSchema,
});

export type CoworkSignedPayState = typeof coworkSignedPayStateSchema.Type;

export type BuildSignedCoworkPayStateInput =
  BuildSignedReservationPayStateInput<
    NormalizedCoworkReservationOrder,
    CoworkReservationQuote
  >;

export const buildSignedCoworkPayState = (
  envelope: SignedPayStateClaims,
  input: BuildSignedCoworkPayStateInput
): CoworkSignedPayState => {
  const reservation = normalizeCoworkReservationOrder({
    ...input.reservation,
    ...input.quote.order,
  });

  return buildSignedReservationPayState(
    envelope,
    input,
    input.quote.summary.total,
    reservation
  );
};
