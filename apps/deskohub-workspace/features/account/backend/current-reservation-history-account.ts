import { Effect } from "effect";
import type { CustomerAccountId } from "../customer-account";
import { CustomerAccountContactService } from "./customer-account-contact.service";
import type { ReservationHistoryAccount } from "./customer-reservation-history.service";

/**
 * The reservations the signed-in account's history lists: with its linked
 * Dotypos customer's once it has one, otherwise only those it authored.
 * Reading the link never claims one, so a read-only caller, such as an AI
 * agent or the customer API, can't link the account as a side effect.
 */
export const currentReservationHistoryAccount = (
  accountId: CustomerAccountId
) =>
  Effect.flatMap(
    CustomerAccountContactService,
    (contacts) => contacts.currentLinkedAccount
  ).pipe(
    Effect.map(
      (linked): ReservationHistoryAccount =>
        linked
          ? {
              accountId: linked.accountId,
              dotyposCustomerId: linked.dotyposCustomerId,
            }
          : { accountId }
    )
  );
