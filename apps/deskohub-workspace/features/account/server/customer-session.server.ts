import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import { cache } from "react";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * Whether the current request carries a usable customer session. Anonymous
 * visitors resolve to no session, and any authentication failure also reads as
 * signed out; account pages and Server Actions still re-check the
 * authoritative session themselves. Memoized per request so the header and
 * account layout share one session read.
 */
export const isCustomerSignedIn = cache(async (): Promise<boolean> => {
  await connection();

  return Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(
    Effect.map((session) => session !== null),
    Effect.orElseSucceed(() => false),
    Effect.provide(CustomerAuthentication.Default),
    runWorkspaceEffect("customer.session.signed-in", { boundary: "page" })
  );
});
