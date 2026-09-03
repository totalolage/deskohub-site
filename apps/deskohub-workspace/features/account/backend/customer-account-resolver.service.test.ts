import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  type CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import {
  type CustomerAccountResolutionDependencies,
  resolveCustomerAccount,
} from "./customer-account-resolver.service";
import type { CustomerAccountSession } from "./customer-authentication.service";

const accountId = customerAccountIdSchema.make("auth-user-1");
const otherAccountId = customerAccountIdSchema.make("auth-user-2");
const verifiedEmail = "ada@example.test";

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
    classify: () => {
      calls.push("classify");
      return Effect.succeed(overrides.matches ?? { kind: "not-found" });
    },
    claimLink: () => {
      calls.push("claim");
      const claimResult = overrides.claimResult ?? "linked";
      return Effect.succeed(
        claimResult === "linked"
          ? ({ kind: "linked", customerId: "60111" } as const)
          : ({ kind: "claimed" } as const)
      );
    },
    reactivate: () => {
      calls.push("reactivate");
      return Effect.succeed(undefined);
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

const matches = (
  result:
    | {
        readonly kind: "not-found";
      }
    | {
        readonly kind: "ambiguous";
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

  test("reserves a unique expired profile and reactivates it after the claim", async () => {
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
    expect(calls.indexOf("claim")).toBeLessThan(calls.indexOf("reactivate"));
  });

  test("requires profile completion without creating a Dotypos profile", async () => {
    const { dependencies, calls } = makeDependencies({
      matches: matches({ kind: "not-found" }),
    });

    const outcome = await runResolution(dependencies);

    await expectAccessError(outcome, "link-required", "not-found");
    expect(calls).not.toContain("create");
  });

  test("returns the common support state for ambiguous matches", async () => {
    const { dependencies } = makeDependencies({
      matches: matches({ kind: "ambiguous" }),
    });

    const outcome = await runResolution(dependencies);

    await expectAccessError(outcome, "link-required", "ambiguous");
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
});
