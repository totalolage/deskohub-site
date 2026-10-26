import { describe, expect, test } from "bun:test";
import { DotyposUncertain } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect } from "effect";
import { SqlError } from "effect/unstable/sql";
import {
  type CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import {
  type CustomerAccountResolutionDependencies,
  resolveCustomerAccount,
  resolveCustomerAccountLink,
} from "./customer-account-resolver.service";
import type { CustomerAccountSession } from "./customer-authentication.service";

const accountId = customerAccountIdSchema.make("auth-user-1");
const otherAccountId = customerAccountIdSchema.make("auth-user-2");
const verifiedEmail = testEmailAddress("ada");

const session = (
  overrides: Partial<CustomerAccountSession> = {}
): CustomerAccountSession => ({
  accountId,
  email: verifiedEmail,
  deletionRequested: false,
  ...overrides,
});

const makeDependencies = (
  overrides: {
    readonly session?: CustomerAccountSession | null;
    readonly lockedSession?: CustomerAccountSession | null;
    readonly link?: string | null;
    readonly matches?: ReturnType<typeof matches>;
    readonly claimResult?: "linked" | "claimed";
    readonly claimCustomerId?: string;
    readonly reactivation?: "succeeds" | "fails";
  } & Partial<CustomerAccountResolutionDependencies> = {}
) => {
  const calls: string[] = [];
  const initial =
    overrides.session !== undefined ? overrides.session : session();
  const inLock =
    overrides.lockedSession !== undefined ? overrides.lockedSession : initial;
  let currentUserCalls = 0;
  const dependencies: CustomerAccountResolutionDependencies = {
    currentUser: () => {
      currentUserCalls += 1;
      return Effect.succeed(currentUserCalls === 1 ? initial : inLock);
    },
    findLink: () => {
      calls.push("find-link");
      return Effect.succeed(overrides.link ?? null);
    },
    isReviewAccount: () => Effect.succeed(false),
    classify: () => {
      calls.push("classify");
      return Effect.succeed(overrides.matches ?? { kind: "not-found" });
    },
    claimLink: (_accountId, customerId) => {
      calls.push("claim");
      const claimResult = overrides.claimResult ?? "linked";
      return Effect.succeed(
        claimResult === "linked"
          ? ({
              kind: "linked",
              customerId: overrides.claimCustomerId ?? customerId,
            } as const)
          : ({ kind: "claimed" } as const)
      );
    },
    reactivate: () => {
      calls.push("reactivate");
      return overrides.reactivation === "fails"
        ? Effect.fail(
            new DotyposUncertain({
              operation: "patchCustomer",
              reason: "transport",
            })
          )
        : Effect.succeed(undefined);
    },
    withAccountLock: (_accountId, effect) => {
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

const sqlFailure = () =>
  new SqlError.SqlError({
    reason: new SqlError.UnknownError({
      cause: new Error("synthetic connection refused"),
      message: "synthetic connection refused",
      operation: "connect",
    }),
  });

const linkQueryFailure = () =>
  new EffectDrizzleQueryError({
    query: "select 1",
    params: [],
    cause: Cause.fail(sqlFailure()),
  });

const expectUnavailable = (
  outcome: Awaited<ReturnType<typeof runResolution>>,
  code: string
) => {
  expect(outcome._tag).toBe("Failure");
  if (outcome._tag === "Failure") {
    const error = outcome.failure as CustomerAccountAccessError;
    expect(error.reason).toBe("unavailable");
    expect(error.cause?.code).toBe(code);
    expect(JSON.stringify(error)).not.toContain("synthetic");
  }
};

const matches = (
  result:
    | {
        readonly kind: "not-found";
      }
    | {
        readonly kind: "ambiguous";
      }
    | {
        readonly kind: "unusable";
      }
    | {
        readonly kind: "matched";
        readonly state: "active" | "expired";
        readonly customerId: string;
      }
) => result;

const runResolution = (dependencies: CustomerAccountResolutionDependencies) =>
  Effect.runPromise(resolveCustomerAccount(dependencies).pipe(Effect.result));

const expectAccessError = async (
  outcome: Awaited<ReturnType<typeof runResolution>>,
  reason: string,
  linkReason?: string
) => {
  expect(outcome._tag).toBe("Failure");
  if (outcome._tag === "Failure") {
    const error = outcome.failure as CustomerAccountAccessError;
    expect(error.reason).toBe(reason);
    expect(error.linkReason).toBe(linkReason);
  }
};

describe("CustomerAccountResolver", () => {
  test("returns the durable link without touching the provider", async () => {
    const { dependencies, calls } = makeDependencies({ link: "60111" });

    const outcome = await runResolution(dependencies);

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      expect(outcome.success).toEqual({
        accountId,
        dotyposCustomerId: "60111",
      });
    }
    expect(calls).toEqual(["lock-acquire", "find-link", "lock-release"]);
  });

  test("links a unique active exact-email profile", async () => {
    const { dependencies, calls } = makeDependencies({
      matches: matches({
        kind: "matched",
        state: "active",
        customerId: "60111",
      }),
    });

    const outcome = await runResolution(dependencies);

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      expect(outcome.success.dotyposCustomerId).toBe("60111");
    }
    expect(calls).toEqual([
      "lock-acquire",
      "find-link",
      "classify",
      "claim",
      "lock-release",
    ]);
  });

  test("reactivates a unique expired profile before claiming the link", async () => {
    const { dependencies, calls } = makeDependencies({
      matches: matches({
        kind: "matched",
        state: "expired",
        customerId: "60222",
      }),
    });

    const outcome = await runResolution(dependencies);

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      expect(outcome.success.dotyposCustomerId).toBe("60222");
    }
    expect(calls.indexOf("reactivate")).toBeLessThan(calls.indexOf("claim"));
  });

  test("keeps an expired profile unclaimed when reactivation fails", async () => {
    const failedAttempt = makeDependencies({
      matches: matches({
        kind: "matched",
        state: "expired",
        customerId: "60222",
      }),
      reactivation: "fails",
    });

    const failedOutcome = await runResolution(failedAttempt.dependencies);

    await expectAccessError(failedOutcome, "unavailable");
    expect(failedAttempt.calls).not.toContain("claim");
  });

  test("returns the linked customer the claim confirmed, not another match", async () => {
    const { dependencies } = makeDependencies({
      matches: matches({
        kind: "matched",
        state: "active",
        customerId: "60111",
      }),
      claimCustomerId: "60333",
    });

    const outcome = await runResolution(dependencies);

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      expect(outcome.success.dotyposCustomerId).toBe("60333");
    }
  });

  test("returns the common support state for a deleted or unusable profile without claiming or reactivating", async () => {
    const { dependencies, calls } = makeDependencies({
      matches: matches({ kind: "unusable" }),
    });

    const outcome = await runResolution(dependencies);

    await expectAccessError(outcome, "link-required", "unusable");
    expect(calls).toEqual([
      "lock-acquire",
      "find-link",
      "classify",
      "lock-release",
    ]);
  });

  test("rejects an already claimed profile", async () => {
    const { dependencies } = makeDependencies({
      matches: matches({
        kind: "matched",
        state: "active",
        customerId: "60111",
      }),
      claimResult: "claimed",
    });

    const outcome = await runResolution(dependencies);

    await expectAccessError(outcome, "link-required", "claimed");
  });

  test("reports unauthenticated sessions before any lock or provider work", async () => {
    const { dependencies, calls } = makeDependencies({ session: null });

    const outcome = await runResolution(dependencies);

    await expectAccessError(outcome, "unauthenticated");
    expect(calls).toEqual([]);
  });

  test("blocks resolution while a deletion marker is present", async () => {
    const { dependencies, calls } = makeDependencies({
      session: session({ deletionRequested: true }),
    });

    const outcome = await runResolution(dependencies);

    await expectAccessError(outcome, "link-required", "deletion-requested");
    expect(calls).toEqual([]);
  });

  test("rereads authority inside the lock and rejects a switched account", async () => {
    const { dependencies, calls } = makeDependencies({
      lockedSession: session({ accountId: otherAccountId }),
    });

    const outcome = await runResolution(dependencies);

    await expectAccessError(outcome, "unauthenticated");
    expect(calls).toEqual(["lock-acquire", "lock-release"]);
  });

  test("rereads the deletion marker inside the lock", async () => {
    const { dependencies, calls } = makeDependencies({
      lockedSession: session({ deletionRequested: true }),
    });

    const outcome = await runResolution(dependencies);

    await expectAccessError(outcome, "link-required", "deletion-requested");
    expect(calls).toEqual(["lock-acquire", "lock-release"]);
  });

  test("reports an auto-link only when this resolution claimed an existing profile", async () => {
    const resolveLink = (dependencies: CustomerAccountResolutionDependencies) =>
      Effect.runPromise(resolveCustomerAccountLink(dependencies));

    await expect(
      resolveLink(makeDependencies({ link: "60111" }).dependencies)
    ).resolves.toEqual({
      account: { accountId, dotyposCustomerId: "60111" },
      autoLinked: false,
    });
    await expect(
      resolveLink(
        makeDependencies({
          matches: matches({
            kind: "matched",
            state: "active",
            customerId: "60111",
          }),
        }).dependencies
      )
    ).resolves.toEqual({
      account: { accountId, dotyposCustomerId: "60111" },
      autoLinked: true,
    });
    await expect(
      resolveLink(
        makeDependencies({
          matches: matches({
            kind: "matched",
            state: "expired",
            customerId: "60222",
          }),
        }).dependencies
      )
    ).resolves.toEqual({
      account: { accountId, dotyposCustomerId: "60222" },
      autoLinked: true,
    });
  });

  test("reports a failed link read as the fixed link-read unavailability", async () => {
    const { dependencies } = makeDependencies({
      findLink: () => Effect.fail(linkQueryFailure()),
    });

    expectUnavailable(await runResolution(dependencies), "account-link.read");
  });

  test("reports a failed lock acquisition as the fixed lock unavailability", async () => {
    const { dependencies } = makeDependencies({
      withAccountLock: () => Effect.fail(sqlFailure()),
    });

    expectUnavailable(await runResolution(dependencies), "account-link.lock");
  });
});
