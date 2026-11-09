import { and, asc, eq, notExists, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { alias } from "drizzle-orm/pg-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { accountRoleGrants, customerAccounts } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { AccountRole } from "../account-role";

type AccountRoleGrantKey = {
  readonly accountId: CustomerAccountId;
  readonly role: AccountRole;
};

/** A held role with the login emails an operator recognizes. */
export type AccountRoleGrant = {
  readonly accountId: CustomerAccountId;
  readonly email: string;
  /** Null when a bootstrap granted the role or the granter was deleted. */
  readonly grantedBy: {
    readonly accountId: CustomerAccountId;
    readonly email: string;
  } | null;
  readonly grantedAt: Temporal.Instant;
};

interface IAccountRoleGrants {
  /**
   * Grants a role to an existing account. Granting a role the account
   * already holds changes nothing and keeps the original grant.
   */
  readonly grant: (
    input: AccountRoleGrantKey & {
      /** Null when a bootstrap grants the role rather than an account. */
      readonly grantedBy: CustomerAccountId | null;
    }
  ) => Effect.Effect<{ readonly changed: boolean }, EffectDrizzleQueryError>;
  readonly revoke: (
    input: AccountRoleGrantKey
  ) => Effect.Effect<{ readonly changed: boolean }, EffectDrizzleQueryError>;
  /**
   * Reads the grant from the database on every call, so a revocation takes
   * effect on the next check. A review account holds no role.
   */
  readonly has: (
    input: AccountRoleGrantKey
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  /**
   * Like `has`, but share-locks the grant until the surrounding transaction
   * ends, so a concurrent revoke waits for that transaction and then sees
   * what it wrote.
   */
  readonly lockHeld: (
    input: AccountRoleGrantKey
  ) => Effect.Effect<boolean, EffectDrizzleQueryError, WorkspaceTransaction>;
  /** Every account holding `role`, oldest grant first. */
  readonly list: (
    role: AccountRole
  ) => Effect.Effect<ReadonlyArray<AccountRoleGrant>, EffectDrizzleQueryError>;
}

export class AccountRoleGrants extends Context.Service<
  AccountRoleGrants,
  IAccountRoleGrants
>()("@deskohub-workspace/administrators/AccountRoleGrants") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const matchesGrant = ({ accountId, role }: AccountRoleGrantKey) =>
        and(
          eq(accountRoleGrants.accountId, accountId),
          eq(accountRoleGrants.role, role)
        );
      /**
       * App-directory reviewers share a review account's password, so a
       * grant on one, however it got there, gives no role.
       */
      const outsideReviewAccounts = notExists(
        sql`(select 1 from ${customerAccounts} where ${and(
          eq(customerAccounts.id, accountRoleGrants.accountId),
          eq(customerAccounts.review, true)
        )})`
      );

      return {
        grant: Effect.fn("AccountRoleGrants.grant")(function* ({
          accountId,
          grantedBy,
          role,
        }) {
          const inserted = yield* db
            .insert(accountRoleGrants)
            .values({ accountId, role, grantedByAccountId: grantedBy })
            .onConflictDoNothing()
            .returning({ accountId: accountRoleGrants.accountId });
          return { changed: inserted.length > 0 };
        }),
        revoke: Effect.fn("AccountRoleGrants.revoke")(function* (key) {
          const deleted = yield* db
            .delete(accountRoleGrants)
            .where(matchesGrant(key))
            .returning({ accountId: accountRoleGrants.accountId });
          return { changed: deleted.length > 0 };
        }),
        has: Effect.fn("AccountRoleGrants.has")(function* (key) {
          const [grant] = yield* db
            .select({ accountId: accountRoleGrants.accountId })
            .from(accountRoleGrants)
            .where(and(matchesGrant(key), outsideReviewAccounts))
            .limit(1);
          return grant !== undefined;
        }),
        lockHeld: Effect.fn("AccountRoleGrants.lockHeld")(function* (key) {
          const { db } = yield* WorkspaceTransaction;
          const [grant] = yield* db
            .select({ accountId: accountRoleGrants.accountId })
            .from(accountRoleGrants)
            .where(and(matchesGrant(key), outsideReviewAccounts))
            .limit(1)
            .for("share");
          return grant !== undefined;
        }),
        list: Effect.fn("AccountRoleGrants.list")(function* (role) {
          const granter = alias(authUser, "granter");
          const rows = yield* db
            .select({
              accountId: accountRoleGrants.accountId,
              email: authUser.email,
              granterAccountId: accountRoleGrants.grantedByAccountId,
              granterEmail: granter.email,
              grantedAt: accountRoleGrants.grantedAt,
            })
            .from(accountRoleGrants)
            .innerJoin(authUser, eq(authUser.id, accountRoleGrants.accountId))
            .leftJoin(
              granter,
              eq(granter.id, accountRoleGrants.grantedByAccountId)
            )
            .where(and(eq(accountRoleGrants.role, role), outsideReviewAccounts))
            .orderBy(asc(accountRoleGrants.grantedAt), asc(authUser.email));
          return rows.map(
            (row): AccountRoleGrant => ({
              accountId: row.accountId,
              email: row.email,
              grantedBy:
                row.granterAccountId !== null && row.granterEmail !== null
                  ? { accountId: row.granterAccountId, email: row.granterEmail }
                  : null,
              grantedAt: row.grantedAt,
            })
          );
        }),
      } satisfies IAccountRoleGrants;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
