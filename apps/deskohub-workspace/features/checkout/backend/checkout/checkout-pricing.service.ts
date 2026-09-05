import { Context, Effect, Layer, Match } from "effect";
import { DiscountService } from "@/features/discounts/discount.service";
import {
  type CoworkAdvertisementAffirmation,
  type CoworkAdvertisementAffirmationInput,
  type CoworkAdvertisementQuote,
  type CoworkAdvertisementQuoteInput,
  type CoworkCheckoutPricingError,
  type CoworkCustomerQuote,
  type CoworkCustomerQuoteInput,
  type CoworkDiscountCodePriceInput,
  type CoworkDiscountCodePriceResult,
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
  type MeetingRoomDiscountCodePriceInput,
  type MeetingRoomDiscountCodePriceResult,
  type MeetingRoomPaymentPriceAffirmation,
  type MeetingRoomPaymentPriceAffirmationInput,
  meetingRoomCheckoutPricing,
} from "./meeting-room-checkout-pricing";
import {
  type OfficeAdvertisementAffirmation,
  type OfficeAdvertisementAffirmationInput,
  type OfficeAdvertisementQuote,
  type OfficeAdvertisementQuoteInput,
  type OfficeCheckoutPricingError,
  type OfficeCustomerQuote,
  type OfficeCustomerQuoteInput,
  type OfficeDiscountCodePriceInput,
  type OfficeDiscountCodePriceResult,
  type OfficePaymentPriceAffirmation,
  type OfficePaymentPriceAffirmationInput,
  officeCheckoutPricing,
} from "./office-checkout-pricing";

export type CheckoutPricingError =
  | CoworkCheckoutPricingError
  | MeetingRoomCheckoutPricingError
  | OfficeCheckoutPricingError;

export type AdvertisementQuoteInput =
  | CoworkAdvertisementQuoteInput
  | MeetingRoomAdvertisementQuoteInput
  | OfficeAdvertisementQuoteInput;

export type AdvertisementQuote =
  | CoworkAdvertisementQuote
  | MeetingRoomAdvertisementQuote
  | OfficeAdvertisementQuote;

export type CustomerQuoteInput =
  | CoworkCustomerQuoteInput
  | MeetingRoomCustomerQuoteInput
  | OfficeCustomerQuoteInput;

export type PreparedCustomerQuote =
  | CoworkCustomerQuote
  | MeetingRoomCustomerQuote
  | OfficeCustomerQuote;

export type PaymentPriceAffirmationInput =
  | CoworkPaymentPriceAffirmationInput
  | MeetingRoomPaymentPriceAffirmationInput
  | OfficePaymentPriceAffirmationInput;

export type PaymentPriceAffirmation =
  | CoworkPaymentPriceAffirmation
  | MeetingRoomPaymentPriceAffirmation
  | OfficePaymentPriceAffirmation;

export type DiscountCodePriceInput =
  | CoworkDiscountCodePriceInput
  | MeetingRoomDiscountCodePriceInput
  | OfficeDiscountCodePriceInput;

export type DiscountCodePriceResult =
  | CoworkDiscountCodePriceResult
  | MeetingRoomDiscountCodePriceResult
  | OfficeDiscountCodePriceResult;

export interface ICheckoutPricingService {
  readonly quoteAdvertisement: (
    input: AdvertisementQuoteInput
  ) => Effect.Effect<AdvertisementQuote, CheckoutPricingError>;
  readonly affirmCoworkAdvertisement: (
    input: CoworkAdvertisementAffirmationInput
  ) => Effect.Effect<
    CoworkAdvertisementAffirmation,
    CoworkCheckoutPricingError
  >;
  readonly affirmMeetingRoomAdvertisement: (
    input: MeetingRoomAdvertisementAffirmationInput
  ) => Effect.Effect<
    MeetingRoomAdvertisementAffirmation,
    MeetingRoomCheckoutPricingError
  >;
  readonly affirmOfficeAdvertisement: (
    input: OfficeAdvertisementAffirmationInput
  ) => Effect.Effect<
    OfficeAdvertisementAffirmation,
    OfficeCheckoutPricingError
  >;
  readonly quoteForCustomer: (
    input: CustomerQuoteInput
  ) => Effect.Effect<PreparedCustomerQuote, CheckoutPricingError>;
  readonly affirmForPayment: (
    input: PaymentPriceAffirmationInput
  ) => Effect.Effect<PaymentPriceAffirmation, CheckoutPricingError>;
  readonly applyDiscountCode: (
    input: DiscountCodePriceInput
  ) => Effect.Effect<DiscountCodePriceResult, CheckoutPricingError>;
}

export class CheckoutPricingService extends Context.Service<
  CheckoutPricingService,
  ICheckoutPricingService
>()("@deskohub-workspace/checkout/CheckoutPricingService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const cowork = yield* coworkCheckoutPricing;
      const meetingRoom = yield* meetingRoomCheckoutPricing;
      const office = yield* officeCheckoutPricing;

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
          Match.when({ reservation: { kind: "office" } }, (officeInput) =>
            office.quoteAdvertisement(officeInput)
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
          Match.when({ reservation: { kind: "office" } }, (officeInput) =>
            office.quoteForCustomer(officeInput)
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
          Match.when({ reservation: { kind: "office" } }, (officeInput) =>
            office.affirmForPayment(officeInput)
          ),
          Match.exhaustive
        )
      );

      const applyDiscountCode = Effect.fn(
        "CheckoutPricingService.applyDiscountCode"
      )((input: DiscountCodePriceInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.applyDiscountCode(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) =>
              meetingRoom.applyDiscountCode(meetingRoomInput)
          ),
          Match.when({ reservation: { kind: "office" } }, (officeInput) =>
            office.applyDiscountCode(officeInput)
          ),
          Match.exhaustive
        )
      );

      return {
        quoteAdvertisement,
        affirmCoworkAdvertisement: cowork.affirmAdvertisement,
        affirmMeetingRoomAdvertisement: meetingRoom.affirmAdvertisement,
        affirmOfficeAdvertisement: office.affirmAdvertisement,
        quoteForCustomer,
        affirmForPayment,
        applyDiscountCode,
      } satisfies ICheckoutPricingService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(DiscountService.Live));
}
