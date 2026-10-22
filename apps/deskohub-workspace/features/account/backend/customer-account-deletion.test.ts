import { describe, expect, test } from "bun:test";
import { ExternalAPIError, NetworkError } from "@deskohub/dotypos";
import { Effect } from "effect";
import { customerAccountIdSchema } from "../customer-account";
import {
  type CustomerAccountDeletionDependencies,
  expireLinkedDotyposProfile,
} from "./customer-account-deletion";

const accountId = customerAccountIdSchema.make("auth-user-1");

const makeDependencies = (
  overrides: {
    readonly link?: string | null;
    readonly reviewAccount?: boolean;
    readonly expireOutcome?: Effect.Effect<void, unknown>;
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
      return (overrides.expireOutcome ?? Effect.void) as Effect.Effect<
        void,
        never
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
        new NetworkError({ message: "connection reset" })
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
      avatarOutcome: Effect.fail(
        new NetworkError({ message: "connection reset" })
      ),
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    expect(calls).not.toContain("tombstone");
  });

  test("tolerates a definitively missing provider profile", async () => {
    const { dependencies, calls } = makeDependencies({
      expireOutcome: Effect.fail(
        new ExternalAPIError({
          service: "Dotypos",
          operation: "patchCustomer",
          statusCode: 404,
        })
      ),
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
});
