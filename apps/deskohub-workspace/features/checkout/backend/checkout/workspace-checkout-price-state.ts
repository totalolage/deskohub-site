import { Schema } from "effect";
import { coworkReservationQuoteSchema } from "@/features/checkout/checkout-quote";
import { locales } from "@/features/i18n";
import { checkoutStateClaimsSchema } from "./checkout-state-token";

export const workspaceCheckoutPriceStateSchema = Schema.Struct({
  ...checkoutStateClaimsSchema.fields,
  locale: Schema.Literals(locales),
  quote: coworkReservationQuoteSchema,
});
