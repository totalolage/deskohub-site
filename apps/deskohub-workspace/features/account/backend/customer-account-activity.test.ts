import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Semaphore } from "effect";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import { guardOptionalAccountStateCreation } from "./customer-account-activity";
import type { CustomerAccountActivityState } from "./customer-account-link.repository";

const accountId = customerAccountIdSchema.make(
  "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01"
);

type GuardBackend = Parameters<typeof guardOptionalAccountStateCreation>[0];

const activeState = (): CustomerAccountActivityState => ({
  kind: "active",
  deletionRequestedAt: null,
});

const makeBackend = (options: {
  readonly events: string[];
  readonly activityState: () => CustomerAccountActivityState;
  readonly sessionUnavailable?: boolean;
}): GuardBackend => ({
  currentUser: options.sessionUnavailable
    ? Effect.fail(new CustomerAccountAccessError({ reason: "unavailable" }))
    : Effect.succeed({
        accountId,
        email: reservationCustomerEmailSchema.make("ada@example.test"),
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
  withAccountLock: (_lockedAccountId, effect) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        options.events.push("account-lock-acquired");
      }),
      () => effect,
      () =>
        Effect.sync(() => {
          options.events.push("account-lock-released");
        })
    ),
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

const makeDeletion = (options: {
  readonly events: string[];
  readonly lock: ReturnType<typeof makeFakeAdvisoryLock>;
  readonly marker: { deletionRequestedAt: Date | null };
}) =>
  import("./customer-account-deletion").then(({ expireLinkedDotyposProfile }) =>
    expireLinkedDotyposProfile({
      markDeletionRequested: () =>
        Effect.sync(() => {
          options.marker.deletionRequestedAt = new Date(
            "2026-09-01T10:00:00.000Z"
          );
          options.events.push("deletion-mark");
        }),
      findLink: () => Effect.succeed(null),
      expireCustomer: () => Effect.void,
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
    });

    const sectionStarted = await Effect.runPromise(Deferred.make<boolean>());
    const stateCreation = Effect.gen(function* () {
      events.push("state-creation");
      yield* Deferred.succeed(sectionStarted, true);
      return "created" as const;
    });
    const guarded = guardOptionalAccountStateCreation(backend, stateCreation);

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const guardFiber = yield* Effect.forkChild(guarded);
        yield* Deferred.await(sectionStarted);
        const deletionFiber = yield* Effect.forkChild(deletion);
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
    });

    const stateCreation = Effect.sync(() => {
      events.push("state-creation");
      return "created" as const;
    });
    const guarded = guardOptionalAccountStateCreation(backend, stateCreation);

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
      guardOptionalAccountStateCreation(backend, stateCreation)
    );

    expect(outcome).toBe("created");
    expect(events).toEqual(["account-session", "state-creation"]);
  });

  test("runs anonymous state creation unchanged when authentication is explicitly not configured", async () => {
    const events: string[] = [];
    const backend: GuardBackend = {
      currentUser: Effect.fail(
        new CustomerAccountAccessError({ reason: "not-configured" })
      ),
      findActivityState: () => Effect.die("activity must not be read"),
      withAccountLock: () => Effect.die("lock must not be acquired"),
    };
    const stateCreation = Effect.sync(() => {
      events.push("state-creation");
      return "created" as const;
    });

    const outcome = await Effect.runPromise(
      guardOptionalAccountStateCreation(backend, stateCreation)
    );

    expect(outcome).toBe("created");
    expect(events).toEqual(["state-creation"]);
  });

  test("fails closed when the session authority cannot be read", async () => {
    const events: string[] = [];
    const backend = makeBackend({
      events,
      activityState: activeState,
      sessionUnavailable: true,
    });
    const stateCreation = Effect.sync(() => {
      events.push("state-creation");
      return "created" as const;
    });

    const error = await Effect.runPromise(
      Effect.flip(guardOptionalAccountStateCreation(backend, stateCreation))
    );

    expect(error).toMatchObject({
      _tag: "CustomerAccountAccessError",
      reason: "unavailable",
    });
    expect(events).toEqual([]);
  });

  test("re-reads authoritative activity under the same lock the section holds", async () => {
    const events: string[] = [];
    const backend = makeBackend({ events, activityState: activeState });

    await Effect.runPromise(
      guardOptionalAccountStateCreation(backend, Effect.succeed("created"))
    );

    expect(events.indexOf("account-activity")).toBeGreaterThan(
      events.indexOf("account-lock-acquired")
    );
    expect(events.indexOf("account-activity")).toBeLessThan(
      events.indexOf("account-lock-released")
    );
  });
});
