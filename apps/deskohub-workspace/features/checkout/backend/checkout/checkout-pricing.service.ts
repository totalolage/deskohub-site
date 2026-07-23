import { Context, Effect, Layer, Match } from "effect";
import {
  type CoworkAdvertisementAffirmation,
  type CoworkAdvertisementAffirmationInput,
  type CoworkAdvertisementQuote,
  type CoworkAdvertisementQuoteInput,
  type CoworkCheckoutPricingError,
  type CoworkCustomerQuote,
  type CoworkCustomerQuoteInput,
  type CoworkPaymentPriceAffirmation,
  type CoworkPaymentPriceAffirmationInput,
  coworkCheckoutPricing,
} from "./cowork-checkout-pricing";
import {
  type MeetingRoomAdvertisementAffirmation,
  type MeetingRoomAdvertisementAffirmationInput,
  type MeetingRoomAdvertisementQuote,
  type MeetingRoomAdvertisementQuoteInput,
  type MeetingRoomCheckoutPricingError,
  type MeetingRoomCustomerQuote,
  type MeetingRoomCustomerQuoteInput,
  type MeetingRoomPaymentPriceAffirmation,
  type MeetingRoomPaymentPriceAffirmationInput,
  meetingRoomCheckoutPricing,
} from "./meeting-room-checkout-pricing";

export type CheckoutPricingError =
  | CoworkCheckoutPricingError
  | MeetingRoomCheckoutPricingError;

export type AdvertisementQuoteInput =
  | CoworkAdvertisementQuoteInput
  | MeetingRoomAdvertisementQuoteInput;

export type AdvertisementQuote =
  | CoworkAdvertisementQuote
  | MeetingRoomAdvertisementQuote;

export type AdvertisementAffirmationInput =
  | CoworkAdvertisementAffirmationInput
  | MeetingRoomAdvertisementAffirmationInput;

export type AdvertisementAffirmation =
  | CoworkAdvertisementAffirmation
  | MeetingRoomAdvertisementAffirmation;

export type CustomerQuoteInput =
  | CoworkCustomerQuoteInput
  | MeetingRoomCustomerQuoteInput;

export type PreparedCustomerQuote =
  | CoworkCustomerQuote
  | MeetingRoomCustomerQuote;

export type PaymentPriceAffirmationInput =
  | CoworkPaymentPriceAffirmationInput
  | MeetingRoomPaymentPriceAffirmationInput;

export type PaymentPriceAffirmation =
  | CoworkPaymentPriceAffirmation
  | MeetingRoomPaymentPriceAffirmation;

export interface ICheckoutPricingService {
  readonly quoteAdvertisement: (
    input: AdvertisementQuoteInput
  ) => Effect.Effect<AdvertisementQuote, CheckoutPricingError>;
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
      const cowork = yield* coworkCheckoutPricing;
      const meetingRoom = yield* meetingRoomCheckoutPricing;

      const quoteAdvertisement = Effect.fn(
        "CheckoutPricingService.quoteAdvertisement"
      )((input: AdvertisementQuoteInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.quoteAdvertisement(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) =>
              meetingRoom.quoteAdvertisement(meetingRoomInput)
          ),
          Match.exhaustive
        )
      );

      const affirmAdvertisement = Effect.fn(
        "CheckoutPricingService.affirmAdvertisement"
      )((input: AdvertisementAffirmationInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.affirmAdvertisement(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) =>
              meetingRoom.affirmAdvertisement(meetingRoomInput)
          ),
          Match.exhaustive
        )
      );

      const quoteForCustomer = Effect.fn(
        "CheckoutPricingService.quoteForCustomer"
      )((input: CustomerQuoteInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.quoteForCustomer(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) => meetingRoom.quoteForCustomer(meetingRoomInput)
          ),
          Match.exhaustive
        )
      );

      const affirmForPayment = Effect.fn(
        "CheckoutPricingService.affirmForPayment"
      )((input: PaymentPriceAffirmationInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.affirmForPayment(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) => meetingRoom.affirmForPayment(meetingRoomInput)
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
