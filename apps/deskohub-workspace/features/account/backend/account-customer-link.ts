import { Effect } from "effect";
import type { AccountCustomerLinkResponse } from "../account-customer-link";
import { CustomerAccountAccessError } from "../customer-account";
import type { CurrentCustomerAccount } from "./current-customer-account";

const signedOut: AccountCustomerLinkResponse = {
  accountId: null,
  dotyposCustomerId: null,
};

/**
 * The customer-link route's own policy over the standing it peeks, so the
 * read never creates or reactivates a customer: only identifiers, and no
 * customer for an account awaiting deletion. A standing that can't say
 * whether a link exists fails.
 */
export const accountCustomerLinkFor = (
  standing: Effect.Success<CurrentCustomerAccount["Service"]["peek"]>
): Effect.Effect<AccountCustomerLinkResponse, CustomerAccountAccessError> => {
  switch (standing.kind) {
    case "signed-out":
      return Effect.succeed(signedOut);
    case "unverified":
      // As the session read reports it.
      return Effect.fail(
        new CustomerAccountAccessError({ reason: "unverified-email" })
      );
    case "deletion-pending":
    case "review":
    case "unlinked":
      return Effect.succeed({
        accountId: standing.session.accountId,
        dotyposCustomerId: null,
      });
    case "linked":
      return Effect.succeed({
        accountId: standing.account.accountId,
        dotyposCustomerId: standing.account.dotyposCustomerId,
      });
    case "unavailable":
      return Effect.fail(standing.failure);
  }
};
