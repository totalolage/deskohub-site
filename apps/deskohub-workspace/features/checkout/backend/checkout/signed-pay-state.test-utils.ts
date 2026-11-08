import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import { checkoutSessionIdSchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";
import type { Locale } from "@/features/i18n";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import { buildSignedPayState, sealPayState } from "./pay-state";

export const syntheticPayStateOrderId =
  workspaceReservationIdSchema.make("reservation-id");

export const syntheticChangedKeys: CheckoutSummaryChangedKeys = {
  sectionKeys: ["order"],
  itemKeys: ["product:cowork:basic"],
};

/**
 * Seals a cowork Pay state with the test key ring. `issuedAt` far enough in
 * the past yields an expired token.
 */
export const sealSyntheticPayStateToken = (input?: {
  readonly locale?: Locale;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly issuedAt?: Temporal.Instant;
}) => {
  const reservation = Schema.decodeUnknownSync(
    normalizedCoworkReservationOrderSchema
  )({
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
    date: "2099-08-04",
    name: "Ada Lovelace",
    email: testEmailAddress("ada"),
    phone: "+420777000111",
  });
  return Effect.runPromise(
    buildSignedPayState(
      {
        locale: input?.locale ?? "en-US",
        reservation,
        quote: buildCoworkReservationQuote(reservation),
        orderId: syntheticPayStateOrderId,
        bookedAt: instantStringSchema.make("2099-07-01T09:58:00.000Z"),
        checkoutSessionId: checkoutSessionIdSchema.make("checkout-session-id"),
        changedKeys: input?.changedKeys,
      },
      { issuedAt: input?.issuedAt }
    ).pipe(
      Effect.flatMap((state) => sealPayState(state)),
      Effect.provide(TestSealedStateKeys)
    )
  );
};
