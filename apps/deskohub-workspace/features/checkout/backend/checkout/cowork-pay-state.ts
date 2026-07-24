import { Match, Schema } from "effect";
import {
  type BuildSignedPayStateCommonInput,
  buildSignedPayStateEnvelope,
  type SignedPayStateEnvelope,
  signedPayStateEnvelopeSchema,
} from "@/features/checkout/backend/checkout/pay-state-contract";
import {
  type CoworkReservationQuote,
  coworkReservationQuoteSchema,
} from "@/features/checkout/checkout-quote";
import {
  type NormalizedCoworkReservationOrder,
  normalizedCoworkReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";

export const coworkSignedPayStateSchema = Schema.Struct({
  ...signedPayStateEnvelopeSchema.fields,
  reservation: normalizedCoworkReservationOrderSchema,
  quote: coworkReservationQuoteSchema,
});

export type CoworkSignedPayState = typeof coworkSignedPayStateSchema.Type;

export type BuildSignedCoworkPayStateInput = BuildSignedPayStateCommonInput & {
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly quote: CoworkReservationQuote;
};

export const buildSignedCoworkPayState = (
  envelope: Omit<
    SignedPayStateEnvelope,
    | "acceptedTotal"
    | "checkoutSessionId"
    | "submittedCode"
    | "submittedCodeDiscountId"
    | "changedKeys"
  >,
  input: BuildSignedCoworkPayStateInput
): CoworkSignedPayState => {
  const reservationBase = {
    kind: "cowork" as const,
    date: input.reservation.date,
    name: input.reservation.name,
    email: input.reservation.email,
    phone: input.reservation.phone,
    ...(input.reservation.message !== undefined && {
      message: input.reservation.message,
    }),
  };

  return {
    ...buildSignedPayStateEnvelope(envelope, input, input.quote.summary.total),
    reservation: Match.value(input.quote.order).pipe(
      Match.discriminatorsExhaustive("entryTier")({
        basic: (product) => ({ ...reservationBase, ...product }),
        plus: (product) => ({ ...reservationBase, ...product }),
        profi: (product) => ({ ...reservationBase, ...product }),
      })
    ),
    quote: {
      fingerprint: input.quote.fingerprint,
      order: input.quote.order,
      summary: input.quote.summary,
      payment: {
        ...input.quote.payment,
        discounts: [...input.quote.payment.discounts],
      },
    },
  };
};
