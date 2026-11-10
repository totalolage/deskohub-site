import { Effect } from "effect";
import { CustomerAccountAccessError } from "../customer-account";
import { CustomerAuthentication } from "./customer-authentication.service";

/**
 * The request's authoritative, verified customer session; a request without
 * one fails as unauthenticated. A pending deletion is not refused here.
 *
 * Use `CurrentCustomerAccount.requireActive` when the deletion refusal
 * directly follows the session read. This is for the callers that must not
 * refuse it there: account deletion (a pending deletion may retry), the
 * locale preference (refused under the lock by the section's recheck), and
 * avatar mutations (the release gate decides before the deletion refusal).
 */
export const requireVerifiedSession = Effect.flatMap(
  CustomerAuthentication,
  (authentication) => authentication.currentUser
).pipe(
  Effect.flatMap((user) =>
    user
      ? Effect.succeed(user)
      : Effect.fail(
          new CustomerAccountAccessError({ reason: "unauthenticated" })
        )
  )
);
