import type { CliSessionIdType } from "@deskohub/workspace-admin-api";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { cliAuthenticationRequests, cliSessions } from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { currentInstant } from "@/shared/utils/temporal";

/**
 * Revokes the unrevoked CLI sessions `owner` approved, or only `sessionId`
 * when given. Returns the IDs it revoked.
 */
export const revokeCliSessions = Effect.fn("revokeCliSessions")(
  function* (input: {
    readonly owner: CustomerAccountId;
    readonly sessionId?: CliSessionIdType;
  }) {
    const { db } = yield* WorkspaceDatabase;
    const now = yield* currentInstant;
    return yield* db
      .update(cliSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(cliSessions.approvedByAccountId, input.owner),
          isNull(cliSessions.revokedAt),
          input.sessionId === undefined
            ? undefined
            : eq(cliSessions.id, input.sessionId)
        )
      )
      .returning({ id: cliSessions.id });
  }
);

/**
 * Ends every CLI credential the account approved: withdraws the grant tokens
 * of its approved, unexchanged requests and revokes its sessions. Run it
 * with the grant removal, so a later re-grant can't revive either.
 */
export const revokeAdministrationCliAccess = Effect.fn(
  "revokeAdministrationCliAccess"
)(function* (accountId: CustomerAccountId) {
  const { db } = yield* WorkspaceDatabase;
  // Tokens first: an exchange consuming one either commits before the
  // session sweep below reads its session, or finds the token gone.
  yield* db
    .update(cliAuthenticationRequests)
    .set({ grantToken: null })
    .where(
      and(
        eq(cliAuthenticationRequests.approvedByAccountId, accountId),
        isNull(cliAuthenticationRequests.consumedAt),
        isNotNull(cliAuthenticationRequests.grantToken)
      )
    );
  yield* revokeCliSessions({ owner: accountId });
});
