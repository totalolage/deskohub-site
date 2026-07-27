import {
  type CoworkReservationQuote,
  coworkReservationQuoteSchema,
} from "@/features/checkout/reservation-quote-cowork";
import {
  type NormalizedCoworkReservationOrder,
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
  return buildSignedReservationPayState(
    envelope,
    input,
    input.quote.payment.expectedPrice,
    input.reservation
  );
};
