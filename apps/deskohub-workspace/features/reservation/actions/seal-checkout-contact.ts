"use server";

import { Effect, Schema } from "effect";
import { checkoutContactReturnState } from "@/features/reservation/backend/checkout-contact-return-state";
import { reservationCheckoutContactSchema } from "@/features/reservation/reservation-checkout-contact";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const sealCheckoutContactAction = defineWorkspaceAction(
  {
    operation: "reservation.checkout-contact.seal",
    schema: Schema.toStandardSchemaV1(reservationCheckoutContactSchema, {
      parseOptions: { onExcessProperty: "error" },
    }),
  },
  (contact) =>
    checkoutContactReturnState.seal(contact).pipe(
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
