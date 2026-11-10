"use server";

import { Effect, Schema } from "effect";
import { defaultPhoneRegion, type Locale } from "@/features/i18n";
import { checkoutContactReturnState } from "@/features/reservation/backend/checkout-contact-return-state";
import { reservationCheckoutContactSchema } from "@/features/reservation/reservation-checkout-contact";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const sealCheckoutContactAction = defineWorkspaceAction(
  {
    operation: "reservation.checkout-contact.seal",
    // The phone is read in the region of the locale it was typed in, and the
    // sealed contact keeps that locale so it reopens in the same region.
    schema: (locale: Locale) =>
      Schema.toStandardSchemaV1(
        reservationCheckoutContactSchema(defaultPhoneRegion(locale)),
        { parseOptions: { onExcessProperty: "error" } }
      ),
  },
  (contact, { locale }) =>
    checkoutContactReturnState.seal(contact, locale).pipe(
      Effect.map((token) => ({ token })),
      Effect.provide(SealedStateKeys.Default)
    )
);

export const sealCheckoutContact: typeof sealCheckoutContactAction = async (
  ...args: Parameters<typeof sealCheckoutContactAction>
) => {
  "use server";
  return await sealCheckoutContactAction(...args);
};
