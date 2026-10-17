import { Schema } from "effect";
import { locales } from "@/features/i18n";
import { sealedStateClaimsSchema } from "@/shared/backend/sealed-state";

export const workspaceCheckoutPriceStateSchema = Schema.Struct({
  ...sealedStateClaimsSchema.fields,
  locale: Schema.Literals(locales),
});
