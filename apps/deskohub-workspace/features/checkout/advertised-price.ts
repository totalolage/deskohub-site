import { Schema } from "effect";
import { coworkReservationQuoteSchema } from "@/features/checkout/checkout-quote";
import { meetingRoomReservationQuoteSchema } from "@/features/checkout/reservation-quote-meeting-room";
import { locales } from "@/features/i18n";
import { coworkAdvertisedPriceReservationSchema } from "@/features/reservation/cowork-reservation";
import { meetingRoomAdvertisedPriceReservationSchema } from "@/features/reservation/meeting-room-reservation";

const advertisedPriceRequestBaseSchema = Schema.Struct({
  locale: Schema.Literals(locales),
});

export const advertisedPriceRequestSchema = Schema.Union([
  Schema.Struct({
    ...advertisedPriceRequestBaseSchema.fields,
    reservation: coworkAdvertisedPriceReservationSchema,
  }),
  Schema.Struct({
    ...advertisedPriceRequestBaseSchema.fields,
    reservation: meetingRoomAdvertisedPriceReservationSchema,
  }),
]).annotate({
  identifier: "AdvertisedPriceRequest",
  description: "Inputs for anonymous price advertisement.",
});

const advertisedPriceBaseSchema = Schema.Struct({
  advertisedPriceToken: Schema.NonEmptyString,
});

const coworkAdvertisedPriceSchema = Schema.Struct({
  ...advertisedPriceBaseSchema.fields,
  kind: coworkAdvertisedPriceReservationSchema.fields.kind,
  quote: coworkReservationQuoteSchema,
});

const meetingRoomAdvertisedPriceSchema = Schema.Struct({
  ...advertisedPriceBaseSchema.fields,
  kind: meetingRoomAdvertisedPriceReservationSchema.fields.kind,
  quote: meetingRoomReservationQuoteSchema,
});

export const advertisedPriceSchema = Schema.Union([
  coworkAdvertisedPriceSchema,
  meetingRoomAdvertisedPriceSchema,
]).annotate({
  identifier: "AdvertisedPrice",
  description:
    "Family-specific advertised quote and its integrity-protected snapshot token.",
});

export type AdvertisedPriceRequest = typeof advertisedPriceRequestSchema.Type;
export type AdvertisedPrice =
  | typeof coworkAdvertisedPriceSchema.Type
  | typeof meetingRoomAdvertisedPriceSchema.Type;

export const isCoworkAdvertisedPrice = Schema.is(coworkAdvertisedPriceSchema);

export const advertisedPriceKeys = {
  all: ["advertised-price"] as const,
  price: (input: AdvertisedPriceRequest) =>
    [...advertisedPriceKeys.all, input] as const,
};
