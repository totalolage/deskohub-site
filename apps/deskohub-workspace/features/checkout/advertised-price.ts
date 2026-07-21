import { Schema } from "effect";
import { workspaceCheckoutQuoteSchema } from "@/features/checkout/checkout-quote";
import { locales } from "@/features/i18n";
import { coworkAdvertisedPriceReservationSchema } from "@/features/reservation/cowork-reservation";

export const workspaceAdvertisedPriceRequestSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  reservation: coworkAdvertisedPriceReservationSchema,
}).annotate({
  identifier: "WorkspaceAdvertisedPriceRequest",
  description: "Inputs for anonymous Workspace price advertisement.",
});

export const workspaceAdvertisedPriceSchema = Schema.Struct({
  quote: workspaceCheckoutQuoteSchema,
  advertisedPriceToken: Schema.NonEmptyString,
}).annotate({
  identifier: "WorkspaceAdvertisedPrice",
  description:
    "Source-neutral advertised quote and its integrity-protected snapshot token.",
});

export type WorkspaceAdvertisedPriceRequest =
  typeof workspaceAdvertisedPriceRequestSchema.Type;
export type WorkspaceAdvertisedPrice =
  typeof workspaceAdvertisedPriceSchema.Type;

const decodeAdvertisedPrice = Schema.decodeUnknownPromise(
  workspaceAdvertisedPriceSchema,
  { onExcessProperty: "error" }
);

export const parseWorkspaceAdvertisedPrice = (input: unknown) =>
  decodeAdvertisedPrice(input);

export const workspaceAdvertisedPriceKeys = {
  all: ["workspace-advertised-price"] as const,
  price: (input: WorkspaceAdvertisedPriceRequest) =>
    [...workspaceAdvertisedPriceKeys.all, input] as const,
};
