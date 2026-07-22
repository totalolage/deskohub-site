import { Context, Data, Effect, Layer, Match, Schema } from "effect";
import {
  type CheckoutQuoteError,
  type CoworkReservationQuote,
  calculateCoworkReservationQuote,
  normalizeCoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import type { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import {
  getMeetingRoomReservationQuote,
  type MeetingRoomReservationQuote,
} from "@/features/checkout/reservation-quote-meeting-room";
import type { WorkspaceMoneyError } from "@/features/checkout/workspace-money";
import {
  type AffirmedDiscountAdvertisementQuote,
  type CanonicalDiscountCode,
  type DiscountCalculationError,
  type DiscountCommitment,
  type DiscountQuote,
  DiscountService,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type {
  CoworkReservationDetails,
  NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import type { NormalizedMeetingRoomReservationOrder } from "@/features/reservation/meeting-room-reservation";
import { getMeetingRoomReservationDate } from "@/features/reservation/meeting-room-reservation-time";

export type CheckoutPricingError =
  | CheckoutQuoteError
  | ReservationQuoteError
  | WorkspaceMoneyError
  | DiscountCalculationError
  | CheckoutPricingInputError;

export class CheckoutPricingInputError extends Data.TaggedError(
  "CheckoutPricingInputError"
)<{
  readonly field: "dotyposCustomerId";
  readonly cause: unknown;
}> {}

export type AdvertisementAffirmation = {
  readonly quote: CoworkReservationQuote;
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
};

export type AdvertisementQuoteInput = {
  readonly reservation: CoworkReservationDetails;
  readonly locale: Locale;
};

export type AdvertisementAffirmationInput = AdvertisementQuoteInput & {
  readonly advertisedQuote: CoworkReservationQuote;
};

type CustomerQuoteCommonInput = {
  readonly dotyposCustomerId: string;
  readonly locale: Locale;
};

export type CustomerQuoteInput = CustomerQuoteCommonInput &
  (
    | {
        readonly reservation: NormalizedCoworkReservationOrder;
        readonly affirmedAdvertisement: AffirmedDiscountAdvertisementQuote;
      }
    | {
        readonly reservation: NormalizedMeetingRoomReservationOrder;
        readonly affirmedAdvertisement?: never;
      }
  );

type PaymentPriceAffirmationCommonInput = {
  readonly dotyposCustomerId: string;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalDiscountCode;
};

export type PaymentPriceAffirmationInput = PaymentPriceAffirmationCommonInput &
  (
    | {
        readonly reservation: NormalizedCoworkReservationOrder;
        readonly displayedQuote: CoworkReservationQuote;
      }
    | {
        readonly reservation: NormalizedMeetingRoomReservationOrder;
        readonly displayedQuote: MeetingRoomReservationQuote;
      }
  );

export type PreparedCustomerQuote =
  | {
      readonly kind: "cowork";
      readonly reservation: NormalizedCoworkReservationOrder;
      readonly quote: CoworkReservationQuote;
    }
  | {
      readonly kind: "meeting-room";
      readonly reservation: NormalizedMeetingRoomReservationOrder;
      readonly quote: MeetingRoomReservationQuote;
    };

export type PaymentPriceAffirmation = PreparedCustomerQuote & {
  readonly commitment: DiscountCommitment;
};

export interface ICheckoutPricingService {
  readonly quoteAdvertisement: (
    input: AdvertisementQuoteInput
  ) => Effect.Effect<CoworkReservationQuote, CheckoutPricingError>;
  readonly affirmAdvertisement: (
    input: AdvertisementAffirmationInput
  ) => Effect.Effect<AdvertisementAffirmation, CheckoutPricingError>;
  readonly quoteForCustomer: (
    input: CustomerQuoteInput
  ) => Effect.Effect<PreparedCustomerQuote, CheckoutPricingError>;
  readonly affirmForPayment: (
    input: PaymentPriceAffirmationInput
  ) => Effect.Effect<PaymentPriceAffirmation, CheckoutPricingError>;
}

export class CheckoutPricingService extends Context.Service<
  CheckoutPricingService,
  ICheckoutPricingService
>()("@deskohub-workspace/checkout/CheckoutPricingService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const discounts = yield* DiscountService;
      const decodeDotyposCustomerId = Schema.decodeUnknownEffect(
        dotyposCustomerIdSchema
      );

      const getDotyposCustomerId = Effect.fn(
        "CheckoutPricingService.getDotyposCustomerId"
      )((value: string) =>
        decodeDotyposCustomerId(value).pipe(
          Effect.mapError(
            (cause) =>
              new CheckoutPricingInputError({
                field: "dotyposCustomerId",
                cause,
              })
          )
        )
      );

      const getCoworkPricingContext = Effect.fn(
        "CheckoutPricingService.getCoworkPricingContext"
      )(function* (input: { readonly reservation: CoworkReservationDetails }) {
        const order = yield* normalizeCoworkReservationQuoteOrder(
          input.reservation
        );
        const product = getWorkspaceProductByTier(order.entryTier);

        return {
          order,
          discountInput: {
            product: { kind: "cowork" as const, tier: order.entryTier },
            discountableSubtotal: product.price,
            reservationDate: input.reservation.date,
          },
        };
      });

      const getMeetingRoomPricingContext = Effect.fn(
        "CheckoutPricingService.getMeetingRoomPricingContext"
      )(function* (input: {
        readonly reservation: NormalizedMeetingRoomReservationOrder;
      }) {
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
        "CheckoutPricingService.buildMeetingRoomQuote"
      )(function* (input: {
        readonly reservation: NormalizedMeetingRoomReservationOrder;
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

      const quoteAdvertisement = Effect.fn(
        "CheckoutPricingService.quoteAdvertisement"
      )((input: AdvertisementQuoteInput) =>
        Effect.succeed(input).pipe(
          Effect.bind("pricing", getCoworkPricingContext),
          Effect.bind("discountQuote", ({ pricing }) =>
            discounts.discoverAdvertisedDiscounts({
              ...pricing.discountInput,
              locale: input.locale,
            })
          ),
          Effect.bind("quote", ({ discountQuote, pricing }) =>
            calculateCoworkReservationQuote(pricing.order, { discountQuote })
          ),
          Effect.map(({ quote }) => quote)
        )
      );

      const affirmAdvertisement = Effect.fn(
        "CheckoutPricingService.affirmAdvertisement"
      )((input: AdvertisementAffirmationInput) =>
        Effect.succeed(input).pipe(
          Effect.bind("pricing", getCoworkPricingContext),
          Effect.bind("discountQuote", ({ pricing }) =>
            discounts.affirmAdvertisement({
              ...pricing.discountInput,
              locale: input.locale,
              advertisedDiscountIds:
                input.advertisedQuote.payment.discounts.map(
                  ({ discount }) => discount.id
                ),
            })
          ),
          Effect.bind("quote", ({ discountQuote, pricing }) =>
            calculateCoworkReservationQuote(pricing.order, { discountQuote })
          ),
          Effect.map(({ discountQuote, quote }) => ({ discountQuote, quote }))
        )
      );

      const quoteCoworkForCustomer = Effect.fn(
        "CheckoutPricingService.quoteCoworkForCustomer"
      )(
        (
          input: Extract<
            CustomerQuoteInput,
            { reservation: { kind: "cowork" } }
          >
        ) =>
          Effect.succeed(input).pipe(
            Effect.bind("pricing", getCoworkPricingContext),
            Effect.bind("dotyposCustomerId", () =>
              getDotyposCustomerId(input.dotyposCustomerId)
            ),
            Effect.bind("discountQuote", ({ dotyposCustomerId }) =>
              discounts.applyCustomerDiscount({
                affirmedAdvertisement: input.affirmedAdvertisement,
                dotyposCustomerId,
                locale: input.locale,
              })
            ),
            Effect.bind("quote", ({ discountQuote, pricing }) =>
              calculateCoworkReservationQuote(pricing.order, { discountQuote })
            ),
            Effect.map(({ quote }) => ({
              kind: input.reservation.kind,
              reservation: input.reservation,
              quote,
            }))
          )
      );

      const quoteMeetingRoomForCustomer = Effect.fn(
        "CheckoutPricingService.quoteMeetingRoomForCustomer"
      )(
        (
          input: Extract<
            CustomerQuoteInput,
            { reservation: { kind: "meeting-room" } }
          >
        ) =>
          Effect.succeed(input).pipe(
            Effect.bind("pricing", getMeetingRoomPricingContext),
            Effect.bind("dotyposCustomerId", () =>
              getDotyposCustomerId(input.dotyposCustomerId)
            ),
            Effect.bind("discountQuote", ({ dotyposCustomerId, pricing }) =>
              discounts.quote({
                ...pricing.discountInput,
                dotyposCustomerId,
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

      const quoteForCustomer = Effect.fn(
        "CheckoutPricingService.quoteForCustomer"
      )((input: CustomerQuoteInput) =>
        Match.value(input).pipe(
          Match.when(
            { reservation: { kind: "cowork" } },
            quoteCoworkForCustomer
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            quoteMeetingRoomForCustomer
          ),
          Match.exhaustive
        )
      );

      const affirmCoworkForPayment = Effect.fn(
        "CheckoutPricingService.affirmCoworkForPayment"
      )(
        (
          input: Extract<
            PaymentPriceAffirmationInput,
            { reservation: { kind: "cowork" } }
          >
        ) =>
          Effect.succeed(input).pipe(
            Effect.bind("pricing", getCoworkPricingContext),
            Effect.bind("dotyposCustomerId", () =>
              getDotyposCustomerId(input.dotyposCustomerId)
            ),
            Effect.bind("affirmation", ({ dotyposCustomerId, pricing }) =>
              discounts.affirmForPayment({
                ...pricing.discountInput,
                dotyposCustomerId,
                locale: input.locale,
                submittedCode: input.submittedCode,
                displayedDiscountIds:
                  input.displayedQuote.payment.discounts.map(
                    ({ discount }) => discount.id
                  ),
              })
            ),
            Effect.bind("quote", ({ affirmation, pricing }) =>
              calculateCoworkReservationQuote(pricing.order, {
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

      const affirmMeetingRoomForPayment = Effect.fn(
        "CheckoutPricingService.affirmMeetingRoomForPayment"
      )(
        (
          input: Extract<
            PaymentPriceAffirmationInput,
            { reservation: { kind: "meeting-room" } }
          >
        ) =>
          Effect.succeed(input).pipe(
            Effect.bind("pricing", getMeetingRoomPricingContext),
            Effect.bind("dotyposCustomerId", () =>
              getDotyposCustomerId(input.dotyposCustomerId)
            ),
            Effect.bind("affirmation", ({ dotyposCustomerId, pricing }) =>
              discounts.affirmForPayment({
                ...pricing.discountInput,
                dotyposCustomerId,
                locale: input.locale,
                submittedCode: input.submittedCode,
                displayedDiscountIds:
                  input.displayedQuote.payment.discounts.map(
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

      const affirmForPayment = Effect.fn(
        "CheckoutPricingService.affirmForPayment"
      )((input: PaymentPriceAffirmationInput) =>
        Match.value(input).pipe(
          Match.when(
            { reservation: { kind: "cowork" } },
            affirmCoworkForPayment
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            affirmMeetingRoomForPayment
          ),
          Match.exhaustive
        )
      );

      return {
        quoteAdvertisement,
        affirmAdvertisement,
        quoteForCustomer,
        affirmForPayment,
      } satisfies ICheckoutPricingService;
    })
  );
}
