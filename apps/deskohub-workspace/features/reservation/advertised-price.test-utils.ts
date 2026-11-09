import { Effect, Schema } from "effect";
import type {
  CoworkAdvertisedPrice,
  CoworkAdvertisedPriceRequest,
  MeetingRoomAdvertisedPrice,
  MeetingRoomAdvertisedPriceRequest,
  OfficeAdvertisedPrice,
  OfficeAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { workspaceMeetingRoomProductsByDurationKey } from "@/features/checkout/meeting-room-product-catalog";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { discountIdSchema } from "@/features/discounts/contracts";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { currencyCZK } from "@/shared/money/currencies";

/** A Calendar sale taking half off the subtotal. */
const halfPriceSale = (
  subtotal: { readonly value: number },
  expiresAt?: string
) => {
  const half = currencyCZK(subtotal.value / 2);
  return {
    discountableSubtotal: currencyCZK(subtotal.value),
    discounts: [
      {
        discount: {
          id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
          label: "Summer sale",
          adjustment: { kind: "percentage" as const, basisPoints: 5000 },
          ...(expiresAt && { expiresAt }),
        },
        subtotalBefore: currencyCZK(subtotal.value),
        amount: half,
        subtotalAfter: half,
      },
    ],
    totalDiscount: half,
    discountedSubtotal: half,
  };
};

/** The cowork price the server advertises for a request, with Open Space at half price. */
export const advertiseCowork = (
  request: CoworkAdvertisedPriceRequest,
  { token = "sealed" }: { readonly token?: string } = {}
): {
  readonly request: CoworkAdvertisedPriceRequest;
  readonly advertisedPrice: CoworkAdvertisedPrice;
} => {
  const { details } = request.reservation;
  const order =
    details.entryTier === "open-space"
      ? { entryTier: "open-space" as const, coffee: details.coffee }
      : {
          entryTier: "reserved-desk" as const,
          coffee: true,
          ...(details.entryTier === "reserved-desk" &&
            details.workstation && { monitorOption: "2x27-qhd" as const }),
        };
  const options =
    details.entryTier === "open-space"
      ? {
          discountQuote: {
            product: { kind: "cowork" as const, tier: "open-space" as const },
            ...halfPriceSale(getWorkspaceProductByTier("open-space").price),
          },
        }
      : {};

  return {
    request,
    advertisedPrice: {
      kind: "cowork",
      quote: buildCoworkReservationQuote(order, options),
      summary: buildCoworkCheckoutSummary(order, options),
      advertisedPriceToken: token,
    },
  };
};

/** The meeting-room price the server advertises for a request, optionally on a half-price sale. */
export const advertiseMeetingRoom = (
  request: MeetingRoomAdvertisedPriceRequest,
  {
    saleExpiresAt,
    token = "sealed",
  }: {
    /** Puts the duration on a half-price sale ending at this instant. */
    readonly saleExpiresAt?: string;
    readonly token?: string;
  } = {}
): {
  readonly request: MeetingRoomAdvertisedPriceRequest;
  readonly advertisedPrice: MeetingRoomAdvertisedPrice;
} => {
  const { duration } = request.reservation.details;
  const { price } =
    workspaceMeetingRoomProductsByDurationKey[
      getMeetingRoomReservationDurationKey(duration)
    ];
  const sale = saleExpiresAt ? halfPriceSale(price, saleExpiresAt) : undefined;
  const quote = {
    fingerprint: `meeting-room-${getMeetingRoomReservationDurationKey(duration)}`,
    items: [
      { type: "meeting-room" as const, duration, amount: price },
    ] as const,
    payment: {
      expectedPrice: sale?.discountedSubtotal ?? price,
      undiscountedPrice: price,
      discounts: sale?.discounts ?? [],
    },
  };

  return {
    request,
    advertisedPrice: {
      kind: "meeting-room",
      quote,
      summary: getMeetingRoomCheckoutSummary(quote),
      advertisedPriceToken: token,
    },
  };
};

/** The office price the server advertises for a request, at catalog prices. */
export const advertiseOffice = (
  request: OfficeAdvertisedPriceRequest,
  { token = "sealed" }: { readonly token?: string } = {}
): {
  readonly request: OfficeAdvertisedPriceRequest;
  readonly advertisedPrice: OfficeAdvertisedPrice;
} => {
  const quote = Effect.runSync(
    buildOfficeReservationQuote(request.reservation.details)
  );

  return {
    request,
    advertisedPrice: {
      kind: "office",
      quote,
      summary: getOfficeCheckoutSummary(quote),
      advertisedPriceToken: token,
    },
  };
};
