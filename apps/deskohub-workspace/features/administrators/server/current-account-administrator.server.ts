import "server-only";

import { Effect, Layer } from "effect";
import { connection } from "next/server";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";
import { AccountRoleGrants } from "../backend/account-role-grants.service";
import { currentAccountIsAdministrator } from "../backend/current-account-administrator";

/**
 * Re-reads the session and the grant on every request, so a revoked grant
 * takes effect on the next page load. Any failure reads as not an
 * administrator.
 */
export const isCurrentAccountAdministrator = async (): Promise<boolean> => {
  await connection();

  return currentAccountIsAdministrator.pipe(
    Effect.provide(
      Layer.mergeAll(CustomerAuthentication.Default, AccountRoleGrants.Live)
    ),
    runWorkspaceEffectOrElse("administrators.current-account", {
      boundary: "page",
      failureCode: "administrator_check_unavailable",
      orElse: () => false,
    })
  );
};
