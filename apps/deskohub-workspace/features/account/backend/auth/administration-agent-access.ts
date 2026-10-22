import { and, arrayContains, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  authOauthAccessToken,
  authOauthConsent,
  authOauthRefreshToken,
} from "@/db/schema/auth";
import { administrationAgentScope } from "../../agent-scopes";
import type { CustomerAccountId } from "../../customer-account";

const administration = [administrationAgentScope];

type Database = WorkspaceDatabase["Service"]["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Whose administration tokens to delete: an account's, or one agent's. */
type AdministrationTokenOwner = {
  readonly accountId: CustomerAccountId;
  readonly clientId?: string;
};

const ownedBy = (
  columns: {
    readonly userId: AnyPgColumn;
    readonly clientId: AnyPgColumn;
    readonly scopes: AnyPgColumn;
  },
  { accountId, clientId }: AdministrationTokenOwner
): SQL | undefined =>
  and(
    eq(columns.userId, accountId),
    clientId === undefined ? undefined : eq(columns.clientId, clientId),
    arrayContains(columns.scopes, administration)
  );

/**
 * Deletes the owner's access and refresh tokens that carry the
 * administration scope. A refresh token's access tokens go with it
 * (ON DELETE CASCADE).
 */
const deleteAdministrationTokens = (
  tx: Transaction,
  owner: AdministrationTokenOwner
) =>
  Effect.all({
    refreshTokens: tx
      .delete(authOauthRefreshToken)
      .where(ownedBy(authOauthRefreshToken, owner))
      .returning({ id: authOauthRefreshToken.id }),
    accessTokens: tx
      .delete(authOauthAccessToken)
      .where(ownedBy(authOauthAccessToken, owner))
      .returning({ id: authOauthAccessToken.id }),
  });

/**
 * Takes the administration away from every AI agent of an account that
 * loses the administrator grant. Without this, a consent recorded while it
 * held the grant would keep approving new authorizations, and refresh
 * tokens keep the scopes they were issued with. So it deletes the consents
 * that include the scope (their tokens cascade) and any remaining tokens
 * that carry it; customer-only connections stay. An affected agent connects
 * again and asks for consent. Better Auth deletes a consent only for its own
 * signed-in customer, so this deletes the rows directly.
 *
 * Issuance is policy, not the boundary: a consent whose check passed just
 * before the grant was revoked can still be written after this runs, and
 * administration calls re-read the grant themselves.
 */
export const revokeAdministrationAgentAccess = Effect.fn(
  "CustomerAgent.revokeAdministrationAccess"
)(function* (accountId: CustomerAccountId) {
  const { db } = yield* WorkspaceDatabase;
  return yield* db.transaction((tx) =>
    Effect.all({
      consents: tx
        .delete(authOauthConsent)
        .where(
          and(
            eq(authOauthConsent.userId, accountId),
            arrayContains(authOauthConsent.scopes, administration)
          )
        )
        .returning({ id: authOauthConsent.id }),
      tokens: deleteAdministrationTokens(tx, { accountId }),
    })
  );
});

/**
 * Deletes one agent's tokens that still carry the administration scope after
 * the account consented to it again without the scope. Better Auth rewrites
 * the consent in place, but tokens keep the scopes they were issued with.
 */
export const revokeAdministrationAgentTokens = Effect.fn(
  "CustomerAgent.revokeAdministrationTokens"
)(function* (owner: Required<AdministrationTokenOwner>) {
  const { db } = yield* WorkspaceDatabase;
  return yield* db.transaction((tx) => deleteAdministrationTokens(tx, owner));
});
