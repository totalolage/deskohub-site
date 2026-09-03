import { Effect } from "effect";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import type { CustomerAccountLinkRepository } from "./customer-account-link.repository";

/**
 * Shared authoritative account activity guard. Every account-authenticated
 * mutation boundary — profile completion, profile edits, reservation and
 * checkout state creation, and resolution — consults this guard before
 * creating state so a durable deletion marker (or a removed auth account row)
 * stops already-authorized work, while anonymous reservation and checkout
 * flows never reach it.
 */
export const requireAccountActivity = (
  links: CustomerAccountLinkRepository["Service"],
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
