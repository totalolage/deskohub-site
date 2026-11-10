import { Effect } from "effect";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import type {
  CustomerAccountActivityState,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";

/** The account still exists and awaits no deletion. */
export const isAccountActive = (activity: CustomerAccountActivityState) =>
  activity.kind === "active" && activity.deletionRequestedAt == null;

/**
 * Fails unless the account still exists and awaits no deletion, so a durable
 * deletion marker (or a removed auth account row) stops already-authorized
 * account work. Work that creates account state runs inside
 * `CustomerAccountSections`, which rechecks this under the account lock.
 */
export const requireAccountActivity = (
  links: Pick<CustomerAccountLinkRepository["Service"], "findActivityState">,
  accountId: CustomerAccountId
): Effect.Effect<void, CustomerAccountAccessError> =>
  links.findActivityState(accountId).pipe(
    Effect.mapError(mapCustomerAccountFailure("account.deletion-state")),
    Effect.flatMap((state) => {
      if (state.kind === "missing") {
        return Effect.fail(
          new CustomerAccountAccessError({ reason: "unauthenticated" })
        );
      }
      if (state.deletionRequestedAt != null) {
        return Effect.fail(
          new CustomerAccountAccessError({
            reason: "link-required",
            linkReason: "deletion-requested",
          })
        );
      }
      return Effect.void;
    })
  );
