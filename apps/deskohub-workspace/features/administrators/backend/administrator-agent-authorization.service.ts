import { Context, Data, Effect, Layer, Match } from "effect";
import { administrationAgentScope } from "@/features/account/agent-scopes";
import {
  CustomerAgentAuthorization,
  type CustomerAgentCaller,
  customerAuthenticationForAgent,
} from "@/features/account/backend/auth/customer-agent-authorization.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { AdministratorAccountActor } from "../account-role";
import { AccountRoleGrants } from "./account-role-grants.service";
import { currentAdministratorAccess } from "./current-administrator";

/**
 * Why an agent may not act in the administration:
 * - `missing-scope`: its grant lacks the administration scope.
 * - `not-administrator`: the account no longer holds the administrator
 *   grant.
 * - `account-unavailable`: the token no longer grants anything, or its
 *   account is deleted, awaiting deletion, or unverified.
 * - `unavailable`: the token or the grant couldn't be checked.
 */
class AdministratorAgentAuthorizationError extends Data.TaggedError(
  "AdministratorAgentAuthorizationError"
)<{
  readonly reason:
    | "missing-scope"
    | "not-administrator"
    | "account-unavailable"
    | "unavailable";
}> {}

const refuse = (reason: AdministratorAgentAuthorizationError["reason"]) =>
  new AdministratorAgentAuthorizationError({ reason });

interface IAdministratorAgentAuthorization {
  /**
   * The administrator an agent acts as. Re-verifies the caller's token and
   * reads the account's grant on every call, as the CLI does for its
   * bearer, so a revoked grant or disconnected agent stops at the next call
   * whatever scopes its token still carries.
   */
  readonly authorize: (
    caller: CustomerAgentCaller
  ) => Effect.Effect<
    AdministratorAccountActor,
    AdministratorAgentAuthorizationError
  >;
}

/**
 * Decides whether a customer's AI agent may act as an administrator: its
 * grant carries the administration scope and the account holds the
 * administrator grant right now. The client the agent connected with plays
 * no part.
 */
export class AdministratorAgentAuthorization extends Context.Service<
  AdministratorAgentAuthorization,
  IAdministratorAgentAuthorization
>()("@deskohub-workspace/administrators/AdministratorAgentAuthorization") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const agents = yield* CustomerAgentAuthorization;
      const grants = yield* AccountRoleGrants;

      /** The live administrator grant of the account the token acts for. */
      const administratorOf = (
        accessToken: string,
        accountId: CustomerAccountId
      ) =>
        currentAdministratorAccess.pipe(
          Effect.provide(customerAuthenticationForAgent(accessToken)),
          Effect.provideService(CustomerAgentAuthorization, agents),
          Effect.provideService(AccountRoleGrants, grants),
          Effect.mapError(() => refuse("unavailable")),
          Effect.flatMap((access) =>
            Match.value(access).pipe(
              Match.discriminatorsExhaustive("kind")({
                administrator: ({ actor }) =>
                  Effect.succeed(actor).pipe(
                    Effect.filterOrFail(
                      (administrator) => administrator.accountId === accountId,
                      () => refuse("not-administrator")
                    )
                  ),
                "not-administrator": () =>
                  Effect.fail(refuse("not-administrator")),
                "signed-out": () => Effect.fail(refuse("account-unavailable")),
              })
            )
          )
        );

      return {
        authorize: ({ grant, accessToken }) =>
          // The token itself, verified again, decides the scope: a caller
          // assembled from another token's grant gets nothing.
          agents.authorize(accessToken).pipe(
            Effect.mapError((error) =>
              refuse(
                error.reason === "unavailable"
                  ? "unavailable"
                  : "account-unavailable"
              )
            ),
            Effect.filterOrFail(
              (verified) => verified.accountId === grant.accountId,
              () => refuse("account-unavailable")
            ),
            Effect.filterOrFail(
              (verified) => verified.scopes.has(administrationAgentScope),
              () => refuse("missing-scope")
            ),
            Effect.flatMap((verified) =>
              administratorOf(accessToken, verified.accountId)
            ),
            Effect.withSpan("AdministratorAgentAuthorization.authorize")
          ),
      } satisfies IAdministratorAgentAuthorization;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(CustomerAgentAuthorization.Default, AccountRoleGrants.Live)
    )
  );
}
