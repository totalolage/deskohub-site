import { Schema } from "effect";
import {
  type BuildSignedPayStateCommonInput,
  buildSignedPayStateEnvelope,
  type SignedPayStateEnvelope,
  signedPayStateEnvelopeSchema,
} from "./pay-state-contract";

export const makeSignedReservationPayStateSchema = <
  Reservation extends Schema.Top,
  Quote extends Schema.Top,
>(input: {
  readonly reservation: Reservation;
  readonly quote: Quote;
}) =>
  Schema.Struct({
    ...signedPayStateEnvelopeSchema.fields,
    reservation: input.reservation,
    quote: input.quote,
  });

export type BuildSignedReservationPayStateInput<Reservation, Quote> =
  BuildSignedPayStateCommonInput & {
    readonly reservation: Reservation;
    readonly quote: Quote;
  };

export type SignedPayStateClaims = Omit<
  SignedPayStateEnvelope,
  | "acceptedTotal"
  | "checkoutSessionId"
  | "submittedCode"
  | "submittedCodeDiscountId"
  | "changedKeys"
>;

export const buildSignedReservationPayState = <Reservation, Quote>(
  envelope: SignedPayStateClaims,
  input: BuildSignedReservationPayStateInput<Reservation, Quote>,
  acceptedTotal: SignedPayStateEnvelope["acceptedTotal"],
  reservation: Reservation
) => ({
  ...buildSignedPayStateEnvelope(envelope, input, acceptedTotal),
  reservation,
  quote: input.quote,
});
