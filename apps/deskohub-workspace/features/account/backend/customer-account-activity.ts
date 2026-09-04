import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
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

export type AccountActivityGuardDependencies = {
  readonly currentUser: Effect.Effect<
    {
      readonly accountId: CustomerAccountId;
    } | null,
    CustomerAccountAccessError
  >;
} & Pick<
  CustomerAccountLinkRepository["Service"],
  "findActivityState" | "withAccountLock"
>;

/**
 * Runs a state-creating section so deletion cannot slip between the
 * authority check and the created state. For an authenticated account the
 * section runs inside the account advisory lock: the authoritative activity
 * is re-read under that lock, and the same lock is held until the section
 * completes, so a concurrent deletion marker can only land before or after
 * the whole section — never inside it. A successfully read null session runs
 * the section unchanged without a lock; a session-authority failure fails
 * closed before any state is created.
 */
export const guardOptionalAccountStateCreation = <A, E, R>(
  dependencies: AccountActivityGuardDependencies,
  stateCreation: Effect.Effect<A, E, R>
): Effect.Effect<A, E | CustomerAccountAccessError | SqlError, R> =>
  dependencies.currentUser.pipe(
    Effect.flatMap((session) =>
      session
        ? dependencies.withAccountLock(
            session.accountId,
            requireAccountActivity(dependencies, session.accountId).pipe(
              Effect.andThen(stateCreation)
            )
          )
        : stateCreation
    )
  );

/**
 * Provider-neutral guard consumed by reservation and checkout mutation
 * boundaries. Better Auth types never cross this service.
 */
export class OptionalAccountActivityGuard extends Context.Service<
  OptionalAccountActivityGuard,
  {
    readonly guardStateCreation: <A, E, R>(
      stateCreation: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | CustomerAccountAccessError | SqlError, R>;
  }
>()("@deskohub-workspace/account/OptionalAccountActivityGuard") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const authentication = yield* CustomerAuthentication;
      const links = yield* CustomerAccountLinkRepository;
      return {
        guardStateCreation: (stateCreation) =>
          guardOptionalAccountStateCreation(
            {
              currentUser: authentication.currentUser,
              findActivityState: links.findActivityState,
              withAccountLock: links.withAccountLock,
            },
            stateCreation
          ),
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
