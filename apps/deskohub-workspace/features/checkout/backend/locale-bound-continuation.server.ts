import "server-only";

import { Effect, Option, Schema } from "effect";
import {
  openPayState,
  payStateContinuesOn,
} from "@/features/checkout/backend/checkout/pay-state.server";
import type { LocaleBoundContinuation } from "@/features/checkout/locale-bound-continuation";
import { openReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessTokenSchema } from "@/features/reservation/reservation-access-token";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";

/**
 * Whether a candidate continuation validates for its page and URL locale with
 * the page's own checks: an authentic, unexpired Pay state for that locale and
 * restoration kind, or an invoice access token with a valid signature for
 * that order and locale (these tokens carry no expiry). Anything else,
 * including a missing secret, is not a continuation, so the saved preference
 * applies. The value is verified exactly as the page reads it.
 */
export const continuesInIssuedLocale = Effect.fn(
  "LocaleBoundContinuation.verify"
)(function* (continuation: LocaleBoundContinuation) {
  if (continuation.kind === "pay-state") {
    const state = yield* openPayState(continuation.token).pipe(
      Effect.provide(SealedStateKeys.Default),
      Effect.option
    );
    return Option.match(state, {
      onNone: () => false,
      onSome: (opened) =>
        payStateContinuesOn(opened, {
          locale: continuation.locale,
          reservationKind: continuation.reservationKind,
        }),
    });
  }

  const token = Option.getOrUndefined(
    Schema.decodeOption(reservationAccessTokenSchema)(continuation.token)
  );
  const orderId = Option.getOrUndefined(
    Schema.decodeOption(workspaceReservationIdSchema)(continuation.orderId)
  );
  if (!token || !orderId) return false;
  const opened = yield* openReservationAccessToken({
    token,
    orderId,
    locale: continuation.locale,
  }).pipe(Effect.option);
  return Option.isSome(opened);
});
