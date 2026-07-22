import { Schema } from "effect";
import { workspaceCheckoutQuoteSchema } from "@/features/checkout/checkout-quote";
import { locales } from "@/features/i18n";
import { coworkAdvertisedPriceReservationSchema } from "@/features/reservation/cowork-reservation";

export const advertisedPriceRequestSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  reservation: coworkAdvertisedPriceReservationSchema,
}).annotate({
  identifier: "AdvertisedPriceRequest",
  description: "Inputs for anonymous price advertisement.",
});

export const advertisedPriceSchema = Schema.Struct({
  quote: workspaceCheckoutQuoteSchema,
  advertisedPriceToken: Schema.NonEmptyString,
}).annotate({
  identifier: "AdvertisedPrice",
  description:
    "Source-neutral advertised quote and its integrity-protected snapshot token.",
});

export type AdvertisedPriceRequest = typeof advertisedPriceRequestSchema.Type;
export type AdvertisedPrice = typeof advertisedPriceSchema.Type;

export const advertisedPriceKeys = {
  all: ["advertised-price"] as const,
  price: (input: AdvertisedPriceRequest) =>
    [...advertisedPriceKeys.all, input] as const,
};
