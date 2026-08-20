import { Schema } from "effect";
import { checkoutSummarySchema } from "@/features/checkout/checkout-summary";
import { coworkReservationQuoteSchema } from "@/features/checkout/reservation-quote-cowork";
import { meetingRoomReservationQuoteSchema } from "@/features/checkout/reservation-quote-meeting-room";
import { officeReservationQuoteSchema } from "@/features/checkout/reservation-quote-office";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import { locales } from "@/features/i18n";
import { coworkAdvertisedPriceReservationSchema } from "@/features/reservation/cowork-reservation";
import { meetingRoomAdvertisedPriceReservationSchema } from "@/features/reservation/meeting-room-reservation";
import { officeAdvertisedPriceReservationSchema } from "@/features/reservation/office-reservation";

const advertisedPriceRequestBaseSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  submittedCode: Schema.optional(canonicalPromotionCodeSchema),
});

const coworkAdvertisedPriceRequestSchema = Schema.Struct({
  ...advertisedPriceRequestBaseSchema.fields,
  reservation: coworkAdvertisedPriceReservationSchema,
});

const meetingRoomAdvertisedPriceRequestSchema = Schema.Struct({
  ...advertisedPriceRequestBaseSchema.fields,
  reservation: meetingRoomAdvertisedPriceReservationSchema,
});

const officeAdvertisedPriceRequestSchema = Schema.Struct({
  ...advertisedPriceRequestBaseSchema.fields,
  reservation: officeAdvertisedPriceReservationSchema,
});

export const advertisedPriceRequestSchema = Schema.Union([
  coworkAdvertisedPriceRequestSchema,
  meetingRoomAdvertisedPriceRequestSchema,
  officeAdvertisedPriceRequestSchema,
]).annotate({
  identifier: "AdvertisedPriceRequest",
  description: "Inputs for anonymous price advertisement.",
});

export const advertisedPriceRequestBatchSize = 16;

export const advertisedPriceRequestsSchema = Schema.Array(
  advertisedPriceRequestSchema
)
  .check(Schema.isMinLength(1))
  .check(Schema.isMaxLength(advertisedPriceRequestBatchSize))
  .annotate({
    identifier: "AdvertisedPriceRequests",
    description: "A bounded batch of anonymous price advertisement inputs.",
  });

const advertisedPriceBaseSchema = Schema.Struct({
  advertisedPriceToken: Schema.NonEmptyString,
});

const coworkAdvertisedPriceSchema = Schema.Struct({
  ...advertisedPriceBaseSchema.fields,
  kind: coworkAdvertisedPriceReservationSchema.fields.kind,
  quote: coworkReservationQuoteSchema,
  summary: checkoutSummarySchema,
});

const meetingRoomAdvertisedPriceSchema = Schema.Struct({
  ...advertisedPriceBaseSchema.fields,
  kind: meetingRoomAdvertisedPriceReservationSchema.fields.kind,
  quote: meetingRoomReservationQuoteSchema,
  summary: checkoutSummarySchema,
});

const officeAdvertisedPriceSchema = Schema.Struct({
  ...advertisedPriceBaseSchema.fields,
  kind: officeAdvertisedPriceReservationSchema.fields.kind,
  quote: officeReservationQuoteSchema,
  summary: checkoutSummarySchema,
});

export const advertisedPriceSchema = Schema.Union([
  coworkAdvertisedPriceSchema,
  meetingRoomAdvertisedPriceSchema,
  officeAdvertisedPriceSchema,
]).annotate({
  identifier: "AdvertisedPrice",
  description:
    "Family-specific advertised quote and its integrity-protected snapshot token.",
});

export type AdvertisedPriceRequest = typeof advertisedPriceRequestSchema.Type;
export type CoworkAdvertisedPriceRequest =
  typeof coworkAdvertisedPriceRequestSchema.Type;
export type MeetingRoomAdvertisedPriceRequest =
  typeof meetingRoomAdvertisedPriceRequestSchema.Type;
export type OfficeAdvertisedPriceRequest =
  typeof officeAdvertisedPriceRequestSchema.Type;
export const advertisedPriceRequestEquals = Schema.toEquivalence(
  advertisedPriceRequestSchema
);
export type AdvertisedPrice =
  | typeof coworkAdvertisedPriceSchema.Type
  | typeof meetingRoomAdvertisedPriceSchema.Type
  | typeof officeAdvertisedPriceSchema.Type;
export type PreloadedAdvertisedPrice = {
  readonly request: AdvertisedPriceRequest;
  readonly advertisedPrice: AdvertisedPrice;
};

export const isCoworkAdvertisedPrice = Schema.is(coworkAdvertisedPriceSchema);
export const isMeetingRoomAdvertisedPrice = Schema.is(
  meetingRoomAdvertisedPriceSchema
);
export const isOfficeAdvertisedPrice = Schema.is(officeAdvertisedPriceSchema);

export const advertisedPriceKeys = {
  all: ["advertised-price"] as const,
  price: (input: AdvertisedPriceRequest) =>
    [...advertisedPriceKeys.all, input] as const,
};
