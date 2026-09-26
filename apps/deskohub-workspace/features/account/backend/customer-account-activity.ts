import { Context, Data, Effect, Layer, Match } from "effect";
import type { SqlError } from "effect/unstable/sql";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
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
 * the whole section — never inside it. A successfully read null session and
 * an explicit authentication-not-configured authority failure (Better Auth
 * secrets are intentionally optional outside production) both run the
 * section unchanged without a lock; any other session-authority failure
 * fails closed before any state is created.
 */
const isAuthenticationNotConfigured = (error: CustomerAccountAccessError) =>
  error.reason === "not-configured";

/**
 * Isolates the advisory-lock boundary. The lock's own database failure is
 * the only error the lock wrapper adds, so the section's typed error is
 * wrapped in this tagged error before entering the lock and unwrapped
 * verbatim afterwards while a lock failure maps to the fixed
 * `account-link.lock` cause. A SqlError carried by the section's own error
 * type therefore never passes through the lock boundary unchanged.
 */
class GuardedSectionError<E> extends Data.TaggedError("GuardedSectionError")<{
  readonly error: E;
}> {}

const restoreSectionError = <E>(
  failure: GuardedSectionError<E> | SqlError.SqlError
): E | CustomerAccountAccessError =>
  // The exhaustive match already guarantees this union; the assertion only
  // collapses Match's deferred Unify wrapper, which TypeScript cannot reduce
  // for a generic E.
  Match.value(failure).pipe(
    Match.tag("GuardedSectionError", (section) => section.error),
    Match.tag("SqlError", () =>
      customerAccountUnavailable("account-link.lock")
    ),
    Match.exhaustive
  ) as E | CustomerAccountAccessError;

export const guardOptionalAccountStateCreation = <A, E, R>(
  dependencies: AccountActivityGuardDependencies,
  stateCreation: Effect.Effect<A, E, R>
): Effect.Effect<A, E | CustomerAccountAccessError, R> =>
  dependencies.currentUser.pipe(
    Effect.catchIf(isAuthenticationNotConfigured, () => Effect.succeed(null)),
    Effect.flatMap((session) =>
      session
        ? dependencies
            .withAccountLock(
              session.accountId,
              requireAccountActivity(dependencies, session.accountId).pipe(
                Effect.andThen(stateCreation),
                Effect.mapError((error) => new GuardedSectionError({ error }))
              )
            )
            .pipe(Effect.mapError(restoreSectionError))
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
    ) => Effect.Effect<A, E | CustomerAccountAccessError, R>;
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
