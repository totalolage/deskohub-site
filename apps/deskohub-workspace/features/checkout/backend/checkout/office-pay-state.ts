import {
  type OfficeReservationQuote,
  officeReservationQuoteSchema,
} from "@/features/checkout/reservation-quote-office";
import {
  type NormalizedOfficeReservationOrder,
  normalizedOfficeReservationOrderSchema,
} from "@/features/reservation/office-reservation";
import {
  type BuildSignedReservationPayStateInput,
  buildSignedReservationPayState,
  makeSignedReservationPayStateSchema,
  type SignedPayStateClaims,
} from "./reservation-pay-state";

export const officeSignedPayStateSchema = makeSignedReservationPayStateSchema({
  reservation: normalizedOfficeReservationOrderSchema,
  quote: officeReservationQuoteSchema,
});

export type OfficeSignedPayState = typeof officeSignedPayStateSchema.Type;

export type BuildSignedOfficePayStateInput =
  BuildSignedReservationPayStateInput<
    NormalizedOfficeReservationOrder,
    OfficeReservationQuote
  >;

export const buildSignedOfficePayState = (
  envelope: SignedPayStateClaims,
  input: BuildSignedOfficePayStateInput
): OfficeSignedPayState =>
  buildSignedReservationPayState(
    envelope,
    input,
    input.quote.payment.expectedPrice,
    input.reservation
  );
