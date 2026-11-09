import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";
import { currentAdministratorAccess } from "../backend/current-administrator";
import { administratorAccessLayer } from "./administrator-access-layer.server";

/**
 * Whether the current request may enter the administration, by the same
 * {@link currentAdministratorAccess} decision the administration guards use.
 * Re-reads the session and the grant on every request, so a revoked grant
 * takes effect on the next page load. Any failure reads as not an
 * administrator.
 */
export const isCurrentAccountAdministrator = async (): Promise<boolean> => {
  await connection();

  return currentAdministratorAccess.pipe(
    Effect.map((access) => access.kind === "administrator"),
    Effect.provide(administratorAccessLayer),
    runWorkspaceEffectOrElse("administrators.current-account", {
      boundary: "page",
      failureCode: "administrator_check_unavailable",
      orElse: () => false,
    })
  );
};
