import { Effect } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { AccountRoleGrants } from "./account-role-grants.service";

/**
 * Whether the account of the current verified session holds the
 * administrator role. Without a session there is no account to check.
 */
export const currentAccountIsAdministrator = Effect.gen(function* () {
  const session = yield* (yield* CustomerAuthentication).currentUser;
  if (session === null) {
    return false;
  }
  const grants = yield* AccountRoleGrants;
  return yield* grants.has({
    accountId: session.accountId,
    role: "administrator",
  });
});
