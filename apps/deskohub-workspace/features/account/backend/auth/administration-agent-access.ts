import { and, arrayContains, eq, notExists, type SQL, sql } from "drizzle-orm";
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

/** The columns both OAuth token tables share. */
type TokenColumns = {
  readonly userId: AnyPgColumn;
  readonly clientId: AnyPgColumn;
  readonly scopes: AnyPgColumn;
  readonly consentId: AnyPgColumn;
};

/** The account's tokens that carry the administration scope. */
const carriesAdministration =
  (accountId: CustomerAccountId) => (columns: TokenColumns) =>
    and(
      eq(columns.userId, accountId),
      arrayContains(columns.scopes, administration)
    );

/** The token's consent, if it still has one, no longer names the scope. */
const outlivesAdministrationConsent = (columns: TokenColumns) =>
  notExists(
    sql`(select 1 from ${authOauthConsent} where ${and(
      eq(authOauthConsent.id, columns.consentId),
      arrayContains(authOauthConsent.scopes, administration)
    )})`
  );

/**
 * Deletes the access and refresh tokens `matching` selects. A refresh
 * token's access tokens go with it (ON DELETE CASCADE).
 */
const deleteTokens = (
  tx: Transaction,
  matching: (columns: TokenColumns) => SQL | undefined
) =>
  Effect.all({
    refreshTokens: tx
      .delete(authOauthRefreshToken)
      .where(matching(authOauthRefreshToken))
      .returning({ id: authOauthRefreshToken.id }),
    accessTokens: tx
      .delete(authOauthAccessToken)
      .where(matching(authOauthAccessToken))
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
      tokens: deleteTokens(tx, carriesAdministration(accountId)),
    })
  );
});

/**
 * Deletes one agent's tokens that carry the administration scope although
 * their consent no longer names it. Better Auth rewrites a consent in place
 * when the account consents again for fewer scopes, but tokens keep the
 * scopes they were issued with. Reading the stored consent rather than the
 * request covers a consent step that ends before or after it records the
 * consent.
 */
export const revokeUnconsentedAdministrationTokens = Effect.fn(
  "CustomerAgent.revokeUnconsentedAdministrationTokens"
)(function* ({
  accountId,
  clientId,
}: {
  readonly accountId: CustomerAccountId;
  readonly clientId: string;
}) {
  const { db } = yield* WorkspaceDatabase;
  return yield* db.transaction((tx) =>
    deleteTokens(tx, (columns) =>
      and(
        carriesAdministration(accountId)(columns),
        eq(columns.clientId, clientId),
        outlivesAdministrationConsent(columns)
      )
    )
  );
});
