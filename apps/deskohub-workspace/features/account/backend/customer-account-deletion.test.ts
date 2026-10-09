import { describe, expect, test } from "bun:test";
import { ExternalAPIError, NetworkError } from "@deskohub/dotypos";
import { Effect, Logger } from "effect";
import { customerAccountIdSchema } from "../customer-account";
import {
  type CustomerAccountDeletionDependencies,
  expireLinkedDotyposProfile,
} from "./customer-account-deletion";
import { CustomerAvatarProviderError } from "./customer-avatar.service";

const accountId = customerAccountIdSchema.make("auth-user-1");

const makeDependencies = (
  overrides: {
    readonly link?: string | null;
    readonly expireOutcome?: Effect.Effect<void, unknown>;
    readonly avatarOutcome?: Effect.Effect<void, unknown>;
  } & Partial<CustomerAccountDeletionDependencies> = {}
) => {
  const calls: string[] = [];
  const dependencies: CustomerAccountDeletionDependencies = {
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
  test("marks, finds the link, and expires the provider profile under the lock", async () => {
    const { dependencies, calls } = makeDependencies();

    await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId)
    );

    expect(calls).toEqual([
      "lock-acquire",
      "marker",
      "find-link",
      "expire",
      "destroy-avatar",
      "lock-release",
    ]);
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
      "lock-acquire",
      "marker",
      "find-link",
      "expire",
      "lock-release",
    ]);
  });

  test("blocks account identity deletion when avatar removal has an unknown provider outcome", async () => {
    const { dependencies, calls } = makeDependencies({
      avatarOutcome: Effect.fail(new Error("media provider unavailable")),
    });

    const outcome = await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    expect(calls).toEqual([
      "lock-acquire",
      "marker",
      "find-link",
      "expire",
      "destroy-avatar",
      "lock-release",
    ]);
  });

  test("logs which provider step left the deletion retryable", async () => {
    const logs: { readonly level: string; readonly message: unknown[] }[] = [];
    const logger = Logger.make((options) => {
      logs.push({
        level: options.logLevel,
        message: Array.isArray(options.message)
          ? options.message
          : [options.message],
      });
    });
    const { dependencies } = makeDependencies({
      avatarOutcome: Effect.fail(new CustomerAvatarProviderError()),
    });

    await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId).pipe(
        Effect.result,
        Effect.provide(Logger.layer([logger]))
      )
    );

    const warning = logs.find(({ level }) => level === "Warn");
    expect(warning?.message[0]).toBe(
      "Customer account deletion: provider cleanup failed; deletion stays retryable."
    );
    expect(warning?.message[1]).toMatchObject({
      cause: { _tag: "CustomerAvatarProviderError" },
      code: "account.deletion.retryable",
    });
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
      "lock-acquire",
      "marker",
      "find-link",
      "destroy-avatar",
      "lock-release",
    ]);
  });

  test("serializes the whole request under one account advisory lock", async () => {
    const { dependencies, calls } = makeDependencies();

    await Effect.runPromise(
      expireLinkedDotyposProfile(dependencies)(accountId)
    );

    expect(calls.filter((call) => call === "lock-acquire")).toHaveLength(1);
    expect(calls.indexOf("lock-release")).toBe(calls.length - 1);
  });
});
