import { Context, Effect, Layer } from "effect";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAuthentication } from "./customer-authentication.service";

/**
 * Shared authoritative account activity guard. Every account-authenticated
 * mutation boundary — profile completion, profile edits, reservation and
 * checkout state creation, and resolution — consults this guard before
 * creating state so a durable deletion marker (or a removed auth account row)
 * stops already-authorized work, while anonymous reservation and checkout
 * flows never reach it.
 */
export const requireAccountActivity = (
  links: Pick<CustomerAccountLinkRepository["Service"], "findActivityState">,
  accountId: CustomerAccountId
): Effect.Effect<void, CustomerAccountAccessError> =>
  links.findActivityState(accountId).pipe(
    Effect.mapError(mapCustomerAccountFailure("account.deletion-state")),
    Effect.flatMap((state) => {
      if (state.kind === "missing") {
        return Effect.fail(
          new CustomerAccountAccessError({ reason: "unauthenticated" })
        );
      }
      if (state.deletionRequestedAt != null) {
        return Effect.fail(
          new CustomerAccountAccessError({
            reason: "link-required",
            linkReason: "deletion-requested",
          })
        );
      }
      return Effect.void;
    })
  );

/**
 * Activity guard for requests that may or may not carry an authoritative
 * account session. Only a successfully read null session stays anonymous; a
 * session-authority failure propagates as the closed public access error so
 * the request can never fall back to anonymous behavior. A successfully read
 * identity must still be an active, unmarked account, so the request fails
 * before the caller creates provider or database state when the deletion
 * marker is present or the auth account row disappeared after the identity
 * was read.
 */
export const requireOptionalAccountActivity = (
  authentication: Pick<CustomerAuthentication["Service"], "currentUser">,
  links: Pick<CustomerAccountLinkRepository["Service"], "findActivityState">
): Effect.Effect<void, CustomerAccountAccessError> =>
  authentication.currentUser.pipe(
    Effect.flatMap((session) =>
      session ? requireAccountActivity(links, session.accountId) : Effect.void
    )
  );

/**
 * Provider-neutral guard consumed by reservation and checkout mutation
 * boundaries. Better Auth types never cross this service.
 */
export class OptionalAccountActivityGuard extends Context.Service<
  OptionalAccountActivityGuard,
  {
    readonly require: Effect.Effect<void, CustomerAccountAccessError>;
  }
>()("@deskohub-workspace/account/OptionalAccountActivityGuard") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const authentication = yield* CustomerAuthentication;
      const links = yield* CustomerAccountLinkRepository;
      return {
        require: requireOptionalAccountActivity(authentication, links),
      };
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAuthentication.Default,
        CustomerAccountLinkRepository.Live
      )
    )
  );
}
