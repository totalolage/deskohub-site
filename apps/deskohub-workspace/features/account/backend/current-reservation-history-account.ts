import { Effect } from "effect";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
} from "../customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";
import type { ReservationHistoryAccount } from "./customer-reservation-history.service";

/** The history's own policy over the standing. */
const historyAccountFor = (
  accountId: CustomerAccountId,
  standing: Effect.Success<CurrentCustomerAccount["Service"]["peek"]>
): Effect.Effect<ReservationHistoryAccount, CustomerAccountAccessError> => {
  switch (standing.kind) {
    case "linked":
      return Effect.succeed({
        accountId: standing.account.accountId,
        dotyposCustomerId: standing.account.dotyposCustomerId,
      });
    case "unverified":
      // As the session read reports it.
      return Effect.fail(
        new CustomerAccountAccessError({ reason: "unverified-email" })
      );
    case "unavailable":
      return Effect.fail(standing.failure);
    case "signed-out":
    case "deletion-pending":
    case "review":
    case "unlinked":
      return Effect.succeed({ accountId });
  }
};

/**
 * The reservations the signed-in account's history lists: with its linked
 * Dotypos customer's once it has one, otherwise only those it authored.
 * It reads the stored link only (`CurrentCustomerAccount.peek`), so a
 * read-only caller, such as an AI agent or the customer API, can't link the
 * account as a side effect.
 */
export const currentReservationHistoryAccount = (
  accountId: CustomerAccountId
) =>
  CurrentCustomerAccount.pipe(
    Effect.flatMap((current) => current.peek),
    Effect.flatMap((standing) => historyAccountFor(accountId, standing))
  );
