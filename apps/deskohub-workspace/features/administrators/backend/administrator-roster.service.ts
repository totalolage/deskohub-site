import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import { findActiveCustomerAccountByEmail } from "@/features/account/backend/customer-account-by-email";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { revokeAdministrationCliAccess } from "@/features/admin-cli/administration-cli-access";
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
   * `email`. Granting it to a current administrator changes nothing.
   */
  readonly grant: (input: {
    readonly email: string;
    readonly actor: AdministratorAccountActor;
  }) => Effect.Effect<
    { readonly changed: boolean; readonly email: string },
    AdministratorAccountNotFoundError | EffectDrizzleQueryError
  >;
  /**
   * Revokes another account's administrator role. The gate reads grants on
   * every request, so the account loses access on its next request. The
   * same transaction revokes the CLI sessions and pending CLI grants the
   * account approved, even when the role was already gone, so a re-grant
   * can't revive them and a retry finishes an interrupted revoke.
   */
  readonly revoke: (input: {
    readonly accountId: CustomerAccountId;
    readonly actor: AdministratorAccountActor;
  }) => Effect.Effect<
    { readonly changed: boolean },
    AdministratorSelfRevocationError | EffectDrizzleQueryError | SqlError
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
          // finish before the session revocation reads the sessions.
          return yield* database.db.transaction(
            Effect.fn(function* () {
              const revoked = yield* grants.revoke({ accountId, role });
              yield* revokeAdministrationCliAccess(accountId).pipe(
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
