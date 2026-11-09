import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import { checkoutSessionIdSchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import type { Locale } from "@/features/i18n";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { instantStringSchema } from "@/shared/utils/temporal";
import { buildSignedPayState, sealPayState } from "./pay-state";

/**
 * Seals a genuine cowork Pay state with the app's own signer and the test
 * key ring. `issuedAt` in the past yields an expired state.
 */
export const sealSyntheticCoworkPayState = ({
  locale,
  issuedAt,
}: {
  readonly locale: Locale;
  readonly issuedAt?: Date;
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const reservation = Schema.decodeUnknownSync(
        normalizedCoworkReservationOrderSchema
      )({
        kind: "cowork",
        entryTier: "basic",
        date: "2099-06-20",
        coffee: false,
        name: "Ada Lovelace",
        email: testEmailAddress("ada"),
        phone: "+420777000111",
      });
      const quote = yield* buildCoworkReservationQuote({
        kind: "cowork",
        entryTier: reservation.entryTier,
        coffee: reservation.coffee,
      });
      const state = yield* buildSignedPayState(
        {
          locale,
          reservation,
          quote,
          orderId: workspaceReservationIdSchema.make("reservation-id"),
          bookedAt: instantStringSchema.make("2026-06-01T09:58:00.000Z"),
          checkoutSessionId: checkoutSessionIdSchema.make("session-id"),
        },
        issuedAt
          ? {
              issuedAt: Temporal.Instant.fromEpochMilliseconds(
                issuedAt.getTime()
              ),
            }
          : {}
      );
      return yield* sealPayState(state);
    }).pipe(Effect.provide(SealedStateKeys.Default))
  );
