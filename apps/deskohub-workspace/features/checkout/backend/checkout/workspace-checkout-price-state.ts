import { Schema } from "effect";
import { locales } from "@/features/i18n";
import { checkoutStateClaimsSchema } from "./checkout-state-token";

export const workspaceCheckoutPriceStateSchema = Schema.Struct({
  ...checkoutStateClaimsSchema.fields,
  locale: Schema.Literals(locales),
});
