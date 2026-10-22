import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Deferred, Effect, Fiber, Semaphore } from "effect";
import { SqlError } from "effect/unstable/sql";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import { guardOptionalAccountStateCreation } from "./customer-account-activity";
import type { CustomerAccountActivityState } from "./customer-account-link.repository";
import {
  CustomerAuthentication,
  type CustomerAuthenticationEnvironment,
} from "./customer-authentication.service";

const customerEmail = testEmailAddress("ada");

const accountId = customerAccountIdSchema.make(
  "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01"
);

type GuardBackend = Parameters<typeof guardOptionalAccountStateCreation>[0];

const serviceCurrentUserFrom = (
  environment: CustomerAuthenticationEnvironment
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return (yield* CustomerAuthentication).currentUser;
    }).pipe(Effect.provide(CustomerAuthentication.fromEnvironment(environment)))
  );

const activeState = (): CustomerAccountActivityState => ({
  kind: "active",
  deletionRequestedAt: null,
});

const makeFakeAdvisoryLock = () => {
  const semaphore = Effect.runSync(Semaphore.make(1));
  return {
    withAccountLock: <A, E, R>(
      _lockedAccountId: typeof accountId,
      effect: Effect.Effect<A, E, R>
    ) => semaphore.withPermits(1)(effect),
  };
};

const makeBackend = (options: {
  readonly events: string[];
  readonly activityState: () => CustomerAccountActivityState;
  readonly sessionUnavailable?: boolean;
  /** Shares one account lock with a concurrent deletion. */
  readonly lock?: ReturnType<typeof makeFakeAdvisoryLock>;
}): GuardBackend => ({
  currentUser: options.sessionUnavailable
    ? Effect.fail(new CustomerAccountAccessError({ reason: "unavailable" }))
    : Effect.succeed({
        accountId,
        email: reservationCustomerEmailSchema.make(customerEmail),
        deletionRequested: false,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            options.events.push("account-session");
          })
        )
      ),
  findActivityState: () =>
    Effect.succeed(options.activityState()).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          options.events.push("account-activity");
        })
      )
    ),
  withAccountLock: (lockedAccountId, effect) => {
    const section = Effect.acquireUseRelease(
      Effect.sync(() => {
        options.events.push("account-lock-acquired");
      }),
      () => effect,
      () =>
        Effect.sync(() => {
          options.events.push("account-lock-released");
        })
    );
    return options.lock
      ? options.lock.withAccountLock(lockedAccountId, section)
      : section;
  },
});

const makeDeletion = (options: {
  readonly events: string[];
  readonly lock: ReturnType<typeof makeFakeAdvisoryLock>;
  readonly marker: { deletionRequestedAt: Date | null };
}) =>
  import("./customer-account-deletion").then(({ expireLinkedDotyposProfile }) =>
    expireLinkedDotyposProfile({
      isReviewAccount: () => Effect.succeed(false),
      markDeletionRequested: () =>
        Effect.sync(() => {
          options.marker.deletionRequestedAt = new Date(
            "2026-09-01T10:00:00.000Z"
          );
          options.events.push("deletion-mark");
        }),
      findLink: () => Effect.succeed(null),
      expireCustomer: () => Effect.void,
      destroyAvatar: () => Effect.void,
      tombstone: () => Effect.void,
      withAccountLock: options.lock.withAccountLock,
    })(accountId)
  );

const markedState = (marker: { deletionRequestedAt: Date | null }) => () =>
  marker.deletionRequestedAt
    ? ({
        kind: "active",
        deletionRequestedAt: marker.deletionRequestedAt,
      } as const)
    : activeState();

describe("optional account activity guard", () => {
  test("deletion cannot mark between the authority check and state creation", async () => {
    const events: string[] = [];
    const lock = makeFakeAdvisoryLock();
    const marker = { deletionRequestedAt: null as Date | null };
    const deletion = await makeDeletion({ events, lock, marker });
    const backend = makeBackend({
      events,
      activityState: markedState(marker),
      lock,
    });

    const sectionStarted = await Effect.runPromise(Deferred.make<void>());
    const releaseSection = await Effect.runPromise(Deferred.make<void>());
    const stateCreation = Effect.gen(function* () {
      events.push("state-creation");
      yield* Deferred.succeed(sectionStarted, undefined);
      yield* Deferred.await(releaseSection);
      return "created" as const;
    });
    const guarded = guardOptionalAccountStateCreation(
      backend,
      () => stateCreation
    );

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const guardFiber = yield* Effect.forkChild(guarded);
        yield* Deferred.await(sectionStarted);
        const deletionFiber = yield* Effect.forkChild(deletion);
        // Deletion gets every chance to run while the section is open; only
        // the shared account lock keeps it from marking.
        for (let turn = 0; turn < 10; turn += 1) yield* Effect.yieldNow;
        expect(marker.deletionRequestedAt).toBeNull();
        yield* Deferred.succeed(releaseSection, undefined);
        const section = yield* Fiber.join(guardFiber);
        yield* Fiber.join(deletionFiber);
        return section;
      })
    );

    expect(outcome).toBe("created");
    expect(events.indexOf("deletion-mark")).toBeGreaterThan(
      events.indexOf("account-lock-released")
    );
    expect(events).toEqual([
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "state-creation",
      "account-lock-released",
      "deletion-mark",
    ]);
  });

  test("does not start state creation once deletion acquired the lock and marked first", async () => {
    const events: string[] = [];
    const lock = makeFakeAdvisoryLock();
    const marker = { deletionRequestedAt: null as Date | null };
    const deletion = await makeDeletion({ events, lock, marker });
    const backend = makeBackend({
      events,
      activityState: markedState(marker),
      lock,
    });

    const stateCreation = Effect.sync(() => {
      events.push("state-creation");
      return "created" as const;
    });
    const guarded = guardOptionalAccountStateCreation(
      backend,
      () => stateCreation
    );

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        yield* deletion;
        return yield* Effect.result(guarded);
      })
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      expect(outcome.failure).toMatchObject({
        _tag: "CustomerAccountAccessError",
        reason: "link-required",
        linkReason: "deletion-requested",
      });
    }
    expect(events).toEqual([
      "deletion-mark",
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "account-lock-released",
    ]);
    expect(events).not.toContain("state-creation");
  });

  test("runs anonymous state creation unchanged without acquiring the lock", async () => {
    const events: string[] = [];
    const backend: GuardBackend = {
      currentUser: Effect.succeed(null).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            events.push("account-session");
          })
        )
      ),
      findActivityState: () =>
        Effect.succeed(activeState()).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              events.push("account-activity");
            })
          )
        ),
      withAccountLock: () => Effect.die("lock must not be acquired"),
    };
    const stateCreation = Effect.sync(() => {
      events.push("state-creation");
      return "created" as const;
    });

    const outcome = await Effect.runPromise(
      guardOptionalAccountStateCreation(backend, () => stateCreation)
    );

    expect(outcome).toBe("created");
    expect(events).toEqual(["account-session", "state-creation"]);
  });

  test("proceeds anonymously when the service classifies authentication as not configured", async () => {
    const events: string[] = [];
    const currentUser = await serviceCurrentUserFrom({
      readBetterAuthSecretsRaw: () => undefined,
      readCurrentSession: () =>
        Promise.reject(new Error("session authority rejected")),
    });
    const backend: GuardBackend = {
      currentUser,
      findActivityState: () => Effect.die("activity must not be read"),
      withAccountLock: () => Effect.die("lock must not be acquired"),
    };
    const stateCreation = Effect.sync(() => {
      events.push("state-creation");
      return "created" as const;
    });

    const outcome = await Effect.runPromise(
      guardOptionalAccountStateCreation(backend, () => stateCreation)
    );

    expect(outcome).toBe("created");
    expect(events).toEqual(["state-creation"]);
  });

  test("blocks state creation when the configured session authority fails", async () => {
    const events: string[] = [];
    const currentUser = await serviceCurrentUserFrom({
      readBetterAuthSecretsRaw: () =>
        "1:test-only-strong-secret-value-9f2c7a41b8e6d530417c",
      readCurrentSession: () =>
        Promise.reject(new Error("database connection refused")),
    });
    const backend: GuardBackend = {
      currentUser,
      findActivityState: () => Effect.die("activity must not be read"),
      withAccountLock: () => Effect.die("lock must not be acquired"),
    };

    const error = await Effect.runPromise(
      Effect.flip(
        guardOptionalAccountStateCreation(backend, () =>
          Effect.succeed("created")
        )
      )
    );

    expect(error).toMatchObject({
      _tag: "CustomerAccountAccessError",
      reason: "unavailable",
    });
    expect((error as CustomerAccountAccessError).cause?.code).toBe(
      "authentication.session"
    );
    expect(events).toEqual([]);
  });

  test("maps an advisory lock failure to the fixed account-link.lock cause without leaking a raw SqlError", async () => {
    const lockFailure = new SqlError.SqlError({
      reason: new SqlError.UnknownError({
        cause: new Error("advisory lock connection lost"),
        message: "advisory lock connection lost",
        operation: "withLock",
      }),
    });
    const backend: GuardBackend = {
      currentUser: Effect.succeed({
        accountId,
        email: reservationCustomerEmailSchema.make(customerEmail),
        deletionRequested: false,
      }),
      findActivityState: () => Effect.succeed(activeState()),
      withAccountLock: () => Effect.fail(lockFailure),
    };

    const error = await Effect.runPromise(
      Effect.flip(
        guardOptionalAccountStateCreation(backend, () =>
          Effect.succeed("created")
        )
      )
    );

    expect(error).toMatchObject({
      _tag: "CustomerAccountAccessError",
      reason: "unavailable",
      cause: { code: "account-link.lock" },
    });
  });

  test("hands state creation the signed-in account it verified under the lock", async () => {
    const events: string[] = [];
    const backend = makeBackend({ events, activityState: activeState });

    const author = await Effect.runPromise(
      guardOptionalAccountStateCreation(backend, (signedInAccountId) =>
        Effect.sync(() => {
          events.push("state-creation");
          return signedInAccountId;
        })
      )
    );

    expect(author).toBe(accountId);
    expect(events).toEqual([
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "state-creation",
      "account-lock-released",
    ]);
  });

  test("hands state creation no account for an anonymous session", async () => {
    const backend: GuardBackend = {
      currentUser: Effect.succeed(null),
      findActivityState: () => Effect.die("activity must not be read"),
      withAccountLock: () => Effect.die("lock must not be acquired"),
    };

    const author = await Effect.runPromise(
      guardOptionalAccountStateCreation(backend, (signedInAccountId) =>
        Effect.succeed(signedInAccountId)
      )
    );

    expect(author).toBeNull();
  });

  test("returns a SqlError raised by state creation itself as the same instance", async () => {
    const events: string[] = [];
    const backend = makeBackend({ events, activityState: activeState });
    const stateCreationFailure = new SqlError.SqlError({
      reason: new SqlError.UnknownError({
        cause: new Error("reservation write violated a constraint"),
        message: "reservation write violated a constraint",
        operation: "insert",
      }),
    });
    const stateCreation: Effect.Effect<never, SqlError.SqlError> =
      Effect.fail(stateCreationFailure);

    const error = await Effect.runPromise(
      Effect.flip(
        guardOptionalAccountStateCreation(backend, () => stateCreation)
      )
    );

    expect(error).toBe(stateCreationFailure);
    expect(events).toEqual([
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "account-lock-released",
    ]);
  });
});
