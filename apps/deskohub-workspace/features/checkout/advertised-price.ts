import { Option, Schema } from "effect";
import { workspaceCheckoutQuoteSchema } from "@/features/checkout/checkout-quote";
import { type Locale, locales } from "@/features/i18n";
import { coworkReservationDetailsSchema } from "@/features/reservation/cowork-reservation";

export const workspaceAdvertisedPriceReservationSchema = Schema.Struct({
  kind: Schema.Literal("cowork"),
  details: coworkReservationDetailsSchema,
}).annotate({
  identifier: "WorkspaceAdvertisedPriceReservation",
  description:
    "PII-free normalized reservation inputs whose price is advertised.",
});

export const workspaceAdvertisedPriceRequestSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  reservation: workspaceAdvertisedPriceReservationSchema,
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

export type WorkspaceAdvertisedPriceReservation =
  typeof workspaceAdvertisedPriceReservationSchema.Type;
export type WorkspaceAdvertisedPriceRequest =
  typeof workspaceAdvertisedPriceRequestSchema.Type;
export type WorkspaceAdvertisedPrice =
  typeof workspaceAdvertisedPriceSchema.Type;

const decodeAdvertisedPrice = Schema.decodeUnknownOption(
  workspaceAdvertisedPriceSchema,
  { onExcessProperty: "error" }
);

export const parseWorkspaceAdvertisedPrice = (
  input: unknown
): WorkspaceAdvertisedPrice => {
  const decoded = decodeAdvertisedPrice(input);
  if (Option.isNone(decoded)) {
    throw new Error("Advertised price response was invalid.");
  }

  return decoded.value;
};

export const workspaceAdvertisedPriceKeys = {
  all: ["workspace-advertised-price"] as const,
  price: (input: WorkspaceAdvertisedPriceRequest) =>
    [...workspaceAdvertisedPriceKeys.all, input] as const,
};

export const getWorkspaceAdvertisedPriceRequest = (input: {
  readonly locale: Locale;
  readonly reservation: WorkspaceAdvertisedPriceReservation;
}): WorkspaceAdvertisedPriceRequest => ({
  locale: input.locale,
  reservation: input.reservation,
});

export const workspaceAdvertisedPriceReservationEquals = (
  left: WorkspaceAdvertisedPriceReservation,
  right: WorkspaceAdvertisedPriceReservation
) =>
  left.kind === right.kind &&
  left.details.entryTier === right.details.entryTier &&
  left.details.coffee === right.details.coffee &&
  left.details.monitorOption === right.details.monitorOption &&
  left.details.date === right.details.date;
