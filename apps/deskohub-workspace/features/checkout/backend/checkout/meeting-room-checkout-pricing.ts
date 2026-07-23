import { Effect } from "effect";
import type { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import {
  getMeetingRoomReservationQuote,
  type MeetingRoomReservationQuote,
} from "@/features/checkout/reservation-quote-meeting-room";
import {
  type AffirmedDiscountAdvertisementQuote,
  type CanonicalDiscountCode,
  type DiscountCalculationError,
  type DiscountCommitment,
  type DiscountQuote,
  DiscountService,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type {
  MeetingRoomAdvertisedPriceReservation,
  MeetingRoomReservationDetails,
  NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import { getMeetingRoomReservationDate } from "@/features/reservation/meeting-room-reservation-time";

export type MeetingRoomCheckoutPricingError =
  | ReservationQuoteError
  | DiscountCalculationError;

export type MeetingRoomAdvertisementQuoteInput = {
  readonly reservation: MeetingRoomAdvertisedPriceReservation;
  readonly locale: Locale;
};

export type MeetingRoomAdvertisementAffirmationInput =
  MeetingRoomAdvertisementQuoteInput & {
    readonly advertisedQuote: MeetingRoomReservationQuote;
  };

export type MeetingRoomCustomerQuoteInput = {
  readonly reservation: NormalizedMeetingRoomReservationOrder;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly affirmedAdvertisement: AffirmedDiscountAdvertisementQuote;
};

export type MeetingRoomPaymentPriceAffirmationInput = {
  readonly reservation: NormalizedMeetingRoomReservationOrder;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly quote: MeetingRoomReservationQuote;
  readonly submittedCode?: CanonicalDiscountCode;
};

export type MeetingRoomAdvertisementQuote = {
  readonly kind: "meeting-room";
  readonly reservation: MeetingRoomAdvertisedPriceReservation;
  readonly quote: MeetingRoomReservationQuote;
};

export type MeetingRoomAdvertisementAffirmation =
  MeetingRoomAdvertisementQuote & {
    readonly discountQuote: AffirmedDiscountAdvertisementQuote;
  };

export type MeetingRoomCustomerQuote = {
  readonly kind: "meeting-room";
  readonly reservation: NormalizedMeetingRoomReservationOrder;
  readonly quote: MeetingRoomReservationQuote;
};

export type MeetingRoomPaymentPriceAffirmation = MeetingRoomCustomerQuote & {
  readonly commitment: DiscountCommitment;
};

interface MeetingRoomCheckoutPricing {
  readonly quoteAdvertisement: (
    input: MeetingRoomAdvertisementQuoteInput
  ) => Effect.Effect<
    MeetingRoomAdvertisementQuote,
    MeetingRoomCheckoutPricingError
  >;
  readonly affirmAdvertisement: (
    input: MeetingRoomAdvertisementAffirmationInput
  ) => Effect.Effect<
    MeetingRoomAdvertisementAffirmation,
    MeetingRoomCheckoutPricingError
  >;
  readonly quoteForCustomer: (
    input: MeetingRoomCustomerQuoteInput
  ) => Effect.Effect<MeetingRoomCustomerQuote, MeetingRoomCheckoutPricingError>;
  readonly affirmForPayment: (
    input: MeetingRoomPaymentPriceAffirmationInput
  ) => Effect.Effect<
    MeetingRoomPaymentPriceAffirmation,
    MeetingRoomCheckoutPricingError
  >;
}

export const meetingRoomCheckoutPricing = Effect.gen(function* () {
  const discounts = yield* DiscountService;

  const quoteAdvertisement = Effect.fn(
    "MeetingRoomCheckoutPricing.quoteAdvertisement"
  )((input: MeetingRoomAdvertisementQuoteInput) =>
    Effect.succeed(input.reservation.details).pipe(
      Effect.bindTo("reservation"),
      Effect.bind("pricing", getMeetingRoomPricingContext),
      Effect.bind("discountQuote", ({ pricing }) =>
        discounts.discoverAdvertisedDiscounts({
          ...pricing.discountInput,
          locale: input.locale,
        })
      ),
      Effect.bind("quote", ({ discountQuote }) =>
        buildMeetingRoomQuote({
          reservation: input.reservation.details,
          discountQuote,
        })
      ),
      Effect.map(({ quote }) => ({
        kind: input.reservation.kind,
        reservation: input.reservation,
        quote,
      }))
    )
  );

  const affirmAdvertisement = Effect.fn(
    "MeetingRoomCheckoutPricing.affirmAdvertisement"
  )((input: MeetingRoomAdvertisementAffirmationInput) =>
    Effect.succeed(input.reservation.details).pipe(
      Effect.bindTo("reservation"),
      Effect.bind("pricing", getMeetingRoomPricingContext),
      Effect.bind("discountQuote", ({ pricing }) =>
        discounts.affirmAdvertisement({
          ...pricing.discountInput,
          locale: input.locale,
          advertisedDiscountIds: input.advertisedQuote.payment.discounts.map(
            ({ discount }) => discount.id
          ),
        })
      ),
      Effect.bind("quote", ({ discountQuote }) =>
        buildMeetingRoomQuote({
          reservation: input.reservation.details,
          discountQuote,
        })
      ),
      Effect.map(({ discountQuote, quote }) => ({
        kind: input.reservation.kind,
        reservation: input.reservation,
        discountQuote,
        quote,
      }))
    )
  );

  const quoteForCustomer = Effect.fn(
    "MeetingRoomCheckoutPricing.quoteForCustomer"
  )((input: MeetingRoomCustomerQuoteInput) =>
    Effect.succeed(input.reservation).pipe(
      Effect.bindTo("reservation"),
      Effect.bind("discountQuote", () =>
        discounts.applyCustomerDiscount({
          affirmedAdvertisement: input.affirmedAdvertisement,
          dotyposCustomerId: input.dotyposCustomerId,
          locale: input.locale,
        })
      ),
      Effect.bind("quote", ({ discountQuote }) =>
        buildMeetingRoomQuote({
          reservation: input.reservation,
          discountQuote,
        })
      ),
      Effect.map(({ quote }) => ({
        kind: input.reservation.kind,
        reservation: input.reservation,
        quote,
      }))
    )
  );

  const affirmForPayment = Effect.fn(
    "MeetingRoomCheckoutPricing.affirmForPayment"
  )((input: MeetingRoomPaymentPriceAffirmationInput) =>
    Effect.succeed(input.reservation).pipe(
      Effect.bindTo("reservation"),
      Effect.bind("pricing", getMeetingRoomPricingContext),
      Effect.bind("affirmation", ({ pricing }) =>
        discounts.affirmForPayment({
          ...pricing.discountInput,
          dotyposCustomerId: input.dotyposCustomerId,
          locale: input.locale,
          submittedCode: input.submittedCode,
          displayedDiscountIds: input.quote.payment.discounts.map(
            ({ discount }) => discount.id
          ),
        })
      ),
      Effect.bind("quote", ({ affirmation }) =>
        buildMeetingRoomQuote({
          reservation: input.reservation,
          discountQuote: affirmation.quote,
        })
      ),
      Effect.map(({ affirmation, quote }) => ({
        kind: input.reservation.kind,
        reservation: input.reservation,
        quote,
        commitment: affirmation.commitment,
      }))
    )
  );

  return {
    quoteAdvertisement,
    affirmAdvertisement,
    quoteForCustomer,
    affirmForPayment,
  } satisfies MeetingRoomCheckoutPricing;
});

const getMeetingRoomPricingContext = Effect.fn(
  "MeetingRoomCheckoutPricing.getPricingContext"
)(function* (input: { readonly reservation: MeetingRoomReservationDetails }) {
  const undiscountedQuote = yield* getMeetingRoomReservationQuote(
    input.reservation
  );
  const [productItem] = undiscountedQuote.items;

  return {
    discountInput: {
      product: {
        kind: "meeting-room" as const,
        durationMinutes: productItem.durationMinutes,
      },
      discountableSubtotal: productItem.amount,
      reservationDate: getMeetingRoomReservationDate(input.reservation),
    },
  };
});

const buildMeetingRoomQuote = Effect.fn(
  "MeetingRoomCheckoutPricing.buildQuote"
)(function* (input: {
  readonly reservation: MeetingRoomReservationDetails;
  readonly discountQuote: DiscountQuote;
}) {
  const quoteWithoutFingerprint = yield* getMeetingRoomReservationQuote(
    input.reservation,
    { discountQuote: input.discountQuote }
  );

  return {
    ...quoteWithoutFingerprint,
    fingerprint: getReservationQuoteFingerprint(
      input.reservation,
      quoteWithoutFingerprint
    ),
  };
});
