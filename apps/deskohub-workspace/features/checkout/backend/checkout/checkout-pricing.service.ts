import { Context, Effect, Layer, Match } from "effect";
import { DiscountService } from "@/features/discounts/discount.service";
import type { DiscountReleaseGates } from "@/features/discounts/discount-release-gate.service";
import type { Locale } from "@/features/i18n";
import {
  type AdvertisedPriceMismatchError,
  requireAdvertisedPriceStateKind,
} from "./advertised-price-mismatch";
import type { AdvertisedPriceState } from "./advertised-price-state";
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
import type { PriceVerdict } from "./price-verdict";

type CheckoutPricingError =
  | CoworkCheckoutPricingError
  | MeetingRoomCheckoutPricingError
  | OfficeCheckoutPricingError;

type AdvertisementQuoteInput =
  | CoworkAdvertisementQuoteInput
  | MeetingRoomAdvertisementQuoteInput
  | OfficeAdvertisementQuoteInput;

type AdvertisementQuote =
  | CoworkAdvertisementQuote
  | MeetingRoomAdvertisementQuote
  | OfficeAdvertisementQuote;

type CustomerQuoteInput =
  | CoworkCustomerQuoteInput
  | MeetingRoomCustomerQuoteInput
  | OfficeCustomerQuoteInput;

export type PreparedCustomerQuote =
  | CoworkCustomerQuote
  | MeetingRoomCustomerQuote
  | OfficeCustomerQuote;

type PaymentPriceAffirmationInput =
  | CoworkPaymentPriceAffirmationInput
  | MeetingRoomPaymentPriceAffirmationInput
  | OfficePaymentPriceAffirmationInput;

export type PaymentPriceAffirmation =
  | CoworkPaymentPriceAffirmation
  | MeetingRoomPaymentPriceAffirmation
  | OfficePaymentPriceAffirmation;

type DiscountCodePriceInput =
  | CoworkDiscountCodePriceInput
  | MeetingRoomDiscountCodePriceInput
  | OfficeDiscountCodePriceInput;

type DiscountCodePriceResult =
  | CoworkDiscountCodePriceResult
  | MeetingRoomDiscountCodePriceResult
  | OfficeDiscountCodePriceResult;

/**
 * A submitted reservation with the advertisement snapshot its page issued.
 * The snapshot may name any family; it must match the reservation's.
 */
type AdvertisementAffirmationInput = {
  readonly advertisement: AdvertisedPriceState;
  readonly reservation:
    | CoworkAdvertisementAffirmationInput["reservation"]
    | MeetingRoomAdvertisementAffirmationInput["reservation"]
    | OfficeAdvertisementAffirmationInput["reservation"];
  readonly locale: Locale;
  /** Moment the reservation is submitted and its price is locked. */
  readonly bookedAt: Temporal.Instant;
};

export type AdvertisementAffirmation =
  | CoworkAdvertisementAffirmation
  | MeetingRoomAdvertisementAffirmation
  | OfficeAdvertisementAffirmation;

export interface ICheckoutPricingService {
  readonly quoteAdvertisement: (
    input: AdvertisementQuoteInput
  ) => Effect.Effect<AdvertisementQuote, CheckoutPricingError>;
  /**
   * Affirms the advertised price at reservation submission. The price
   * changed when the discounts re-evaluated at the booking moment give a
   * different quote than the snapshot's. A snapshot of another reservation,
   * family, or locale fails; an unanswered discount provider fails too.
   */
  readonly affirmAdvertisement: (
    input: AdvertisementAffirmationInput
  ) => Effect.Effect<
    PriceVerdict<AdvertisementAffirmation>,
    AdvertisedPriceMismatchError | CheckoutPricingError
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

      const affirmAdvertisement = Effect.fn(
        "CheckoutPricingService.affirmAdvertisement"
      )((input: AdvertisementAffirmationInput) =>
        Match.value(input.reservation).pipe(
          Match.discriminatorsExhaustive("kind")({
            cowork: (reservation) =>
              requireAdvertisedPriceStateKind(reservation.kind)(
                input.advertisement
              ).pipe(
                Effect.flatMap((advertisement) =>
                  cowork.affirmAdvertisement({
                    ...input,
                    advertisement,
                    reservation,
                  })
                )
              ),
            "meeting-room": (reservation) =>
              requireAdvertisedPriceStateKind(reservation.kind)(
                input.advertisement
              ).pipe(
                Effect.flatMap((advertisement) =>
                  meetingRoom.affirmAdvertisement({
                    ...input,
                    advertisement,
                    reservation,
                  })
                )
              ),
            office: (reservation) =>
              requireAdvertisedPriceStateKind(reservation.kind)(
                input.advertisement
              ).pipe(
                Effect.flatMap((advertisement) =>
                  office.affirmAdvertisement({
                    ...input,
                    advertisement,
                    reservation,
                  })
                )
              ),
          })
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
        affirmAdvertisement,
        quoteForCustomer,
        affirmForPayment,
        applyDiscountCode,
      } satisfies ICheckoutPricingService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(DiscountService.Live));

  /**
   * Live pricing under discount release gates the caller already decided,
   * for work that must not read the request, such as a cached render.
   */
  static withDiscountReleaseGates = (gates: DiscountReleaseGates) =>
    this.Default.pipe(Layer.provide(DiscountService.withReleaseGates(gates)));
}
