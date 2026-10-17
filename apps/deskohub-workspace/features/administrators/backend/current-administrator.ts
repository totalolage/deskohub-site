import { Effect } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import type { AdministratorAccountActor } from "../account-role";
import { AccountRoleGrants } from "./account-role-grants.service";

/**
 * Who the current request acts as in the administration:
 * - `administrator`: a verified session whose account holds the role.
 * - `signed-out`: no verified session, so signing in may help.
 * - `not-administrator`: a signed-in account without the role, or one
 *   awaiting deletion.
 */
type AdministratorAccess =
  | {
      readonly kind: "administrator";
      readonly actor: AdministratorAccountActor;
    }
  | { readonly kind: "signed-out" }
  | { readonly kind: "not-administrator" };

const signedOut: AdministratorAccess = { kind: "signed-out" };
const notAdministrator: AdministratorAccess = { kind: "not-administrator" };

/**
 * Reads the session and the grant from the database on every call, so a
 * revoked grant or session takes effect on the next request. Session and
 * database failures stay in the error channel; callers fail closed.
 */
export const currentAdministratorAccess = Effect.gen(function* () {
  const session = yield* (yield* CustomerAuthentication).currentUser.pipe(
    Effect.catchTag("CustomerAccountAccessError", (error) =>
      error.reason === "unauthenticated" || error.reason === "unverified-email"
        ? Effect.succeed(null)
        : Effect.fail(error)
    )
  );
  if (session === null) {
    return signedOut;
  }
  if (session.deletionRequested) {
    return notAdministrator;
  }
  const isAdministrator = yield* (yield* AccountRoleGrants).has({
    accountId: session.accountId,
    role: "administrator",
  });
  return isAdministrator
    ? ({
        kind: "administrator",
        actor: { accountId: session.accountId, email: session.email },
      } satisfies AdministratorAccess)
    : notAdministrator;
}).pipe(Effect.withSpan("Administrators.currentAccess"));
