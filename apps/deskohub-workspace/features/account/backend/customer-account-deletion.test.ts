import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  DotyposRejected,
  DotyposService,
  DotyposUnavailable,
  DotyposUncertain,
} from "@deskohub/dotypos";
import { Effect, Layer, Logger, Option } from "effect";
import { customerAccountIdSchema } from "../customer-account";
import {
  type CustomerAccountDeletionDependencies,
  expireLinkedDotyposProfile,
} from "./customer-account-deletion";
import { CustomerAvatarProviderError } from "./customer-avatar.service";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";

const accountId = customerAccountIdSchema.make("auth-user-1");

const makeDependencies = (
  overrides: {
    readonly link?: string | null;
    readonly reviewAccount?: boolean;
    readonly expireOutcome?: ReturnType<
      CustomerAccountDeletionDependencies["expireCustomer"]
    >;
    readonly avatarOutcome?: Effect.Effect<void, unknown>;
  } & Partial<CustomerAccountDeletionDependencies> = {}
) => {
  const calls: string[] = [];
  const dependencies: CustomerAccountDeletionDependencies = {
    isReviewAccount: () => {
      calls.push("review-check");
      return Effect.succeed(overrides.reviewAccount ?? false);
    },
    markDeletionRequested: () => {
      calls.push("marker");
      return Effect.void;
    },
    findLink: () => {
      calls.push("find-link");
      return Effect.succeed(
        "link" in overrides ? (overrides.link ?? null) : "60111"
      );
    },
    expireCustomer: () => {
      calls.push("expire");
      return (overrides.expireOutcome ??
        Effect.succeed(Option.some({} as never))) as ReturnType<
        CustomerAccountDeletionDependencies["expireCustomer"]
      >;
    },
    destroyAvatar: () => {
      calls.push("destroy-avatar");
      return (overrides.avatarOutcome ?? Effect.void) as Effect.Effect<
        void,
        never
      >;
    },
    tombstone: () => {
      calls.push("tombstone");
      return Effect.void;
    },
    withAccountLock: (_key, effect) => {
      calls.push("lock-acquire");
      return Effect.void.pipe(
        Effect.andThen(effect),
        Effect.ensuring(Effect.sync(() => calls.push("lock-release")))
      );
    },
    ...overrides,
  };
  return { dependencies, calls };
};

describe("Customer account deletion", () => {
  test("marks, expires the provider profile, and leaves the tombstone last under the lock", async () => {
    const { dependencies, calls } = makeDependencies();

    await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId)
    );

    expect(calls).toEqual([
      "review-check",
      "lock-acquire",
      "marker",
      "find-link",
      "expire",
      "destroy-avatar",
      "tombstone",
      "lock-release",
    ]);
  });

  test("refuses a review account before it marks, expires, or tombstones anything", async () => {
    const { dependencies, calls } = makeDependencies({
      link: null,
      reviewAccount: true,
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.flip)
    );

    expect(outcome._tag).toBe("ReviewAccountDeletionRefusedError");
    expect(calls).toEqual(["review-check"]);
  });

  test("keeps the durable marker when the provider call fails retryably", async () => {
    const { dependencies, calls } = makeDependencies({
      expireOutcome: Effect.fail(
        new DotyposUncertain({
          operation: "patchCustomer",
          reason: "transport",
        })
      ),
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    expect(calls).toEqual([
      "review-check",
      "lock-acquire",
      "marker",
      "find-link",
      "expire",
      "lock-release",
    ]);
  });

  test("leaves no tombstone while the avatar cleanup can still be retried", async () => {
    const { dependencies, calls } = makeDependencies({
      avatarOutcome: Effect.fail(new CustomerAvatarProviderError({})),
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    expect(calls).not.toContain("tombstone");
  });

  test("tolerates a definitively missing provider profile", async () => {
    const { dependencies, calls } = makeDependencies({
      expireOutcome: Effect.succeed(Option.none()),
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Success");
    expect(calls).toContain("expire");
  });

  test("skips the provider when no link exists yet", async () => {
    const { dependencies, calls } = makeDependencies({ link: null });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Success");
    expect(calls).toEqual([
      "review-check",
      "lock-acquire",
      "marker",
      "find-link",
      "destroy-avatar",
      "tombstone",
      "lock-release",
    ]);
  });

  describe("with the Dotypos adapter", () => {
    const tokenNotFound = new DotyposRejected({
      operation: "patchCustomer",
      request: "customer.version",
      reason: "unauthorized",
      httpStatus: 404,
    });
    const replayNotFound = new DotyposUncertain({
      operation: "patchCustomer",
      request: "customer.patch",
      reason: "server",
      httpStatus: 404,
      cause: new DotyposRejected({
        operation: "patchCustomer",
        request: "customer.patch",
        reason: "not-found",
        httpStatus: 404,
      }),
    });

    const deleteWithDotypos = async (
      dotypos: Partial<DotyposService["Service"]>
    ) => {
      const logCodes: unknown[] = [];
      const capturingLogger = Logger.make(({ message }) => {
        const [, annotations] = Array.isArray(message) ? message : [];
        logCodes.push((annotations as { code?: unknown } | undefined)?.code);
      });
      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* CustomerDotyposAdapter;
          const { dependencies, calls } = makeDependencies({
            expireCustomer: (customerId) => {
              calls.push("expire");
              return adapter.expireCustomer(customerId);
            },
          });
          const result = yield* expireLinkedDotyposProfile(dependencies)(
            accountId
          ).pipe(Effect.result);
          return { result, calls };
        }).pipe(
          Effect.provide(
            CustomerDotyposAdapter.Default.pipe(
              Layer.provide(Layer.mock(DotyposService, dotypos))
            )
          ),
          Effect.provide(Logger.layer([capturingLogger]))
        )
      );
      return { ...outcome, logCodes };
    };

    test("keeps deletion retryable when an access-token 404 ends the expiration patch", async () => {
      const { result, calls, logCodes } = await deleteWithDotypos({
        patchCustomer: () => Effect.fail(tokenNotFound),
      });

      expect(result._tag).toBe("Failure");
      expect(calls).not.toContain("tombstone");
      expect(logCodes).not.toContain("dotypos.customer-expiration.missing");
      expect(logCodes).toContain("account.deletion.retryable");
    });

    test("treats a replayed expiration patch that ends in 404 as a missing profile once the replay finds none", async () => {
      const dotyposCalls: string[] = [];
      const { result, calls, logCodes } = await deleteWithDotypos({
        patchCustomer: () => {
          dotyposCalls.push("patch");
          return dotyposCalls.length === 1
            ? Effect.fail(replayNotFound)
            : Effect.succeed(Option.none<DotyposCustomer>());
        },
        getCustomer: () => {
          dotyposCalls.push("read");
          return Effect.succeed(Option.none<DotyposCustomer>());
        },
      });

      expect(dotyposCalls).toEqual(["patch", "read", "patch"]);
      expect(result._tag).toBe("Success");
      expect(calls).toContain("destroy-avatar");
      expect(calls).toContain("tombstone");
      expect(logCodes).toContain("dotypos.customer-expiration.missing");
      expect(logCodes).not.toContain("account.deletion.retryable");
    });

    test("keeps deletion retryable while replayed expiration patches stay uncertain and rereads find none", async () => {
      const dotyposCalls: string[] = [];
      const { result, calls, logCodes } = await deleteWithDotypos({
        patchCustomer: () => {
          dotyposCalls.push("patch");
          return Effect.fail(replayNotFound);
        },
        getCustomer: () => {
          dotyposCalls.push("read");
          return Effect.succeed(Option.none<DotyposCustomer>());
        },
      });

      expect(dotyposCalls).toEqual(["patch", "read", "patch", "read"]);
      expect(result._tag).toBe("Failure");
      expect(calls).not.toContain("tombstone");
      expect(logCodes).not.toContain("dotypos.customer-expiration.missing");
      expect(logCodes).toContain("account.deletion.retryable");
    });

    test("keeps deletion retryable when an access-token 404 ends the settlement reread", async () => {
      const { result, calls, logCodes } = await deleteWithDotypos({
        patchCustomer: () =>
          Effect.fail(
            new DotyposUncertain({
              operation: "patchCustomer",
              request: "customer.patch",
              reason: "server",
              httpStatus: 503,
            })
          ),
        getCustomer: () =>
          Effect.fail(
            new DotyposRejected({
              operation: "getCustomer",
              request: "customer.get",
              reason: "unauthorized",
              httpStatus: 404,
            })
          ),
      });

      expect(result._tag).toBe("Failure");
      expect(calls).not.toContain("tombstone");
      expect(logCodes).not.toContain("dotypos.customer-expiration.missing");
      expect(logCodes).toContain("account.deletion.retryable");
    });

    test("keeps deletion retryable when the expiration fails with a 503", async () => {
      const { result, calls, logCodes } = await deleteWithDotypos({
        patchCustomer: () =>
          Effect.fail(
            new DotyposUnavailable({
              operation: "patchCustomer",
              request: "customer.patch",
              reason: "server",
              httpStatus: 503,
            })
          ),
        getCustomer: () => Effect.succeed(Option.none<DotyposCustomer>()),
      });

      expect(result._tag).toBe("Failure");
      expect(calls).not.toContain("tombstone");
      expect(logCodes).toContain("account.deletion.retryable");
    });
  });
});
