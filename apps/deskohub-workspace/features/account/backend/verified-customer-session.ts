import { Effect } from "effect";
import { CustomerAccountAccessError } from "../customer-account";
import { CustomerAuthentication } from "./customer-authentication.service";

/**
 * The request's authoritative, verified customer session; a request without
 * one fails as unauthenticated.
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
