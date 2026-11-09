import { Schema } from "effect";
import { checkoutSummarySchema } from "@/features/checkout/checkout-summary";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import { coworkReservationQuoteSchema } from "@/features/checkout/reservation-quote-cowork";
import { meetingRoomReservationQuoteSchema } from "@/features/checkout/reservation-quote-meeting-room";
import { officeReservationQuoteSchema } from "@/features/checkout/reservation-quote-office";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import { locales } from "@/features/i18n";
import { coworkAdvertisedPriceReservationSchema } from "@/features/reservation/cowork-reservation";
import { meetingRoomAdvertisedPriceReservationSchema } from "@/features/reservation/meeting-room-reservation";
import { officeAdvertisedPriceReservationSchema } from "@/features/reservation/office-reservation";
import type { Money } from "@/shared/money/money";

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
export type CoworkAdvertisedPrice = typeof coworkAdvertisedPriceSchema.Type;
export type MeetingRoomAdvertisedPrice =
  typeof meetingRoomAdvertisedPriceSchema.Type;
export type OfficeAdvertisedPrice = typeof officeAdvertisedPriceSchema.Type;
export type AdvertisedPrice =
  | CoworkAdvertisedPrice
  | MeetingRoomAdvertisedPrice
  | OfficeAdvertisedPrice;
export type PreloadedAdvertisedPrice = {
  readonly request: AdvertisedPriceRequest;
  readonly advertisedPrice: AdvertisedPrice;
};

export const isCoworkAdvertisedPrice = Schema.is(coworkAdvertisedPriceSchema);
export const isMeetingRoomAdvertisedPrice = Schema.is(
  meetingRoomAdvertisedPriceSchema
);
export const isOfficeAdvertisedPrice = Schema.is(officeAdvertisedPriceSchema);

/** The order line that carries the product's advertised price. */
export const getAdvertisedProductItem = (
  { summary }: AdvertisedPrice,
  product: WorkspaceProductIdentity
) =>
  summary.sections
    .find(({ key }) => key === "order")
    ?.items.find(
      (item) =>
        "product" in item &&
        getWorkspaceProductKey(item.product) === getWorkspaceProductKey(product)
    );

/** The amount a product's order line advertises, with its price before the sale. */
export const getAdvertisedProductAmount = (
  advertisedPrice: AdvertisedPrice,
  product: WorkspaceProductIdentity
): { readonly amount: Money; readonly originalAmount?: Money } | undefined => {
  const item = getAdvertisedProductItem(advertisedPrice, product);
  if (!item) return undefined;

  return {
    amount: item.amount,
    ...("originalAmount" in item &&
      item.originalAmount && { originalAmount: item.originalAmount }),
  };
};

export const advertisedPriceKeys = {
  all: ["advertised-price"] as const,
  price: (input: AdvertisedPriceRequest) =>
    [...advertisedPriceKeys.all, input] as const,
};
