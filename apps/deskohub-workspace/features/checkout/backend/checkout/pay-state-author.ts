import { Data, Effect } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { openPayStateForLocale } from "./open-pay-state-for-locale";

/**
 * The Pay state's order is missing or another account's. Both read as not
 * found, so a token never confirms that someone else's order exists.
 */
export class PayStateAuthorNotFoundError extends Data.TaggedError(
  "PayStateAuthorNotFoundError"
)<{
  readonly orderId: WorkspaceReservationId;
}> {}

/**
 * Opens a Pay state for the account that authored its order. Review-sandbox
 * holds never issue a Pay state token, so every token names a stored
 * reservation.
 */
export const requirePayStateAuthor = Effect.fn(
  "checkout.requirePayStateAuthor"
)(function* (input: {
  readonly payStateToken: string;
  readonly locale: Locale;
  readonly accountId: CustomerAccountId;
}) {
  const state = yield* openPayStateForLocale(input);
  const reservations = yield* WorkspaceReservationRepository;
  const reservation = yield* reservations.findById(state.orderId);
  if (reservation?.authorAccountId !== input.accountId) {
    return yield* new PayStateAuthorNotFoundError({ orderId: state.orderId });
  }
  return state;
});
