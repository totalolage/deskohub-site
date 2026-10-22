import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { revokeAdministrationAgentAccess } from "@/features/account/backend/auth/administration-agent-access";
import { findActiveCustomerAccountByEmail } from "@/features/account/backend/customer-account-by-email";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { revokeAdministrationCliAccess } from "@/features/admin-cli/administration-cli-access";
import { ReviewAccounts } from "@/features/review-accounts";
import type { AdministratorAccountActor } from "../account-role";
import {
  type AccountRoleGrant,
  AccountRoleGrants,
} from "./account-role-grants.service";

/** No active account signs in with the email, so it can't get the role. */
class AdministratorAccountNotFoundError extends Data.TaggedError(
  "AdministratorAccountNotFoundError"
)<{
  readonly message: string;
}> {}

/**
 * The email belongs to a review account, whose password app-directory
 * reviewers share, so it never holds the role.
 */
class AdministratorReviewAccountError extends Data.TaggedError(
  "AdministratorReviewAccountError"
)<{
  readonly message: string;
}> {}

/** An administrator tried to revoke their own grant and lock themselves out. */
class AdministratorSelfRevocationError extends Data.TaggedError(
  "AdministratorSelfRevocationError"
)<{
  readonly message: string;
}> {}

interface IAdministratorRoster {
  readonly list: Effect.Effect<
    ReadonlyArray<AccountRoleGrant>,
    EffectDrizzleQueryError
  >;
  /**
   * Grants the administrator role to the active account that signs in with
   * `email`. Granting it to a current administrator changes nothing; a
   * review account can't get it.
   */
  readonly grant: (input: {
    readonly email: string;
    readonly actor: AdministratorAccountActor;
  }) => Effect.Effect<
    { readonly changed: boolean; readonly email: string },
    | AdministratorAccountNotFoundError
    | AdministratorReviewAccountError
    | EffectDrizzleQueryError
  >;
  /**
   * Revokes another account's administrator role. The gate reads grants on
   * every request, so the account loses access on its next request. The
   * same transaction revokes the CLI sessions and pending CLI grants the
   * account approved and disconnects its AI agents that may use the
   * administration, even when the role was already gone, so a re-grant
   * can't revive the CLI credentials and a retry finishes an interrupted
   * revoke. An agent consent whose check passed before the revoke commits
   * can still be written afterwards; administration calls re-read the grant.
   */
  readonly revoke: (input: {
    readonly accountId: CustomerAccountId;
    readonly actor: AdministratorAccountActor;
  }) => Effect.Effect<
    { readonly changed: boolean },
    | AdministratorSelfRevocationError
    | EffectDrizzleQueryError
    | SqlError.SqlError
  >;
}

const role = "administrator" as const;

export class AdministratorRoster extends Context.Service<
  AdministratorRoster,
  IAdministratorRoster
>()("@deskohub-workspace/administrators/AdministratorRoster") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* WorkspaceDatabase;
      const grants = yield* AccountRoleGrants;

      return {
        list: grants.list(role),
        grant: Effect.fn("AdministratorRoster.grant")(function* ({
          email,
          actor,
        }) {
          const account = yield* findActiveCustomerAccountByEmail(email).pipe(
            Effect.provideService(WorkspaceDatabase, database),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new AdministratorAccountNotFoundError({
                      message: "No active account signs in with this email.",
                    })
                  ),
                onSome: Effect.succeed,
              })
            )
          );
          const isReviewAccount = yield* Effect.flatMap(
            ReviewAccounts,
            (reviewAccounts) =>
              reviewAccounts.isReviewAccount(account.accountId)
          ).pipe(
            Effect.provide(ReviewAccounts.Default),
            Effect.provideService(WorkspaceDatabase, database)
          );
          if (isReviewAccount) {
            return yield* new AdministratorReviewAccountError({
              message: "A review account can't hold the administrator role.",
            });
          }
          const { changed } = yield* grants.grant({
            accountId: account.accountId,
            role,
            grantedBy: actor.accountId,
          });
          return { changed, email: account.email };
        }),
        revoke: Effect.fn("AdministratorRoster.revoke")(function* ({
          accountId,
          actor,
        }) {
          if (accountId === actor.accountId) {
            return yield* new AdministratorSelfRevocationError({
              message: "Administrators can't revoke their own grant.",
            });
          }
          // Grant first: its row lock makes a concurrent CLI exchange
          // finish before the session revocation reads the sessions, and
          // once it commits, later consent checks refuse the administration
          // scope. One that already passed can still finish; administration
          // calls re-read the grant.
          return yield* database.db.transaction(
            Effect.fn(function* () {
              const revoked = yield* grants.revoke({ accountId, role });
              yield* revokeAdministrationCliAccess(accountId).pipe(
                Effect.provideService(WorkspaceDatabase, database)
              );
              yield* revokeAdministrationAgentAccess(accountId).pipe(
                Effect.provideService(WorkspaceDatabase, database)
              );
              return revoked;
            })
          );
        }),
      } satisfies IAdministratorRoster;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(AccountRoleGrants.Live, WorkspaceDatabase.Default)
    )
  );
}
