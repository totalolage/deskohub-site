import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { Effect, Schema } from "effect";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "../customer-account";
import {
  type CustomerAccountResolutionDependencies,
  resolveCustomerAccount,
} from "./customer-account-resolver.service";
import type { CustomerAuthUser } from "./customer-authentication.service";

const accountId = Schema.decodeUnknownSync(customerAccountIdSchema)(
  "account-1"
);
const customerId = Schema.decodeUnknownSync(DotyposCustomerIdSchema)(
  "customer-1"
);
const user: CustomerAuthUser = {
  email: "guest@example.com",
  emailVerified: true,
  id: accountId,
  name: "Guest",
};

const dependencies = (
  overrides: Partial<CustomerAccountResolutionDependencies> = {}
): CustomerAccountResolutionDependencies => ({
  currentUser: () => Effect.succeed(user),
  findLink: () => Effect.succeed(null),
  findCustomer: () => Effect.succeed({ kind: "matched", customerId }),
  claimLink: () => Effect.succeed({ kind: "linked", customerId }),
  withAccountLock: (_accountId, effect) => effect,
  ...overrides,
});

const runError = (input: CustomerAccountResolutionDependencies) =>
  Effect.runPromise(Effect.flip(resolveCustomerAccount(input)));

describe("customer account resolution", () => {
  test("fails closed when auth is not configured or has no session", async () => {
    const notConfigured = await runError(
      dependencies({
        currentUser: () =>
          Effect.fail(
            new CustomerAccountAccessError({ reason: "not-configured" })
          ),
      })
    );
    const unauthenticated = await runError(
      dependencies({ currentUser: () => Effect.succeed(null) })
    );

    expect(notConfigured.reason).toBe("not-configured");
    expect(unauthenticated.reason).toBe("unauthenticated");
  });

  test("rejects malformed identities and unverified email addresses", async () => {
    const malformed = await runError(
      dependencies({
        currentUser: () => Effect.succeed({ ...user, id: "   " }),
      })
    );
    const unverified = await runError(
      dependencies({
        currentUser: () => Effect.succeed({ ...user, emailVerified: false }),
      })
    );

    expect(malformed.reason).toBe("unauthenticated");
    expect(unverified.reason).toBe("unverified-email");
  });

  test("uses an existing link without looking up Dotypos", async () => {
    let lookups = 0;
    const result = await Effect.runPromise(
      resolveCustomerAccount(
        dependencies({
          findLink: () => Effect.succeed(customerId),
          findCustomer: () =>
            Effect.sync(() => {
              lookups += 1;
              return { kind: "not-found" as const };
            }),
        })
      )
    );

    expect(result).toEqual({ accountId, dotyposCustomerId: customerId });
    expect(lookups).toBe(0);
  });

  test("does not relink from a session captured before the account lock", async () => {
    let sessionReads = 0;
    let claims = 0;
    const error = await runError(
      dependencies({
        currentUser: () =>
          Effect.sync(() => {
            sessionReads += 1;
            return sessionReads === 1 ? user : null;
          }),
        claimLink: () =>
          Effect.sync(() => {
            claims += 1;
            return { kind: "linked" as const, customerId };
          }),
      })
    );

    expect(error.reason).toBe("unauthenticated");
    expect(sessionReads).toBe(2);
    expect(claims).toBe(0);
  });

  test("links the unique active customer found by exact email", async () => {
    let lookup: readonly [string, string] | undefined;
    const result = await Effect.runPromise(
      resolveCustomerAccount(
        dependencies({
          findCustomer: (email, name) => {
            lookup = [email, name];
            return Effect.succeed({ kind: "matched", customerId });
          },
        })
      )
    );

    expect(lookup).toEqual(["guest@example.com", "Guest"]);
    expect(result).toEqual({ accountId, dotyposCustomerId: customerId });
  });

  test.each([
    ["not-found", "not-found"],
    ["ambiguous", "ambiguous"],
  ] as const)("requires manual linking for a %s lookup", async (kind, reason) => {
    const error = await runError(
      dependencies({ findCustomer: () => Effect.succeed({ kind }) })
    );

    expect(error).toMatchObject({
      reason: "link-required",
      linkReason: reason,
    });
  });

  test("rejects a Dotypos customer already claimed by another account", async () => {
    const error = await runError(
      dependencies({ claimLink: () => Effect.succeed({ kind: "claimed" }) })
    );

    expect(error).toMatchObject({
      reason: "link-required",
      linkReason: "claimed",
    });
  });

  test("returns the winner of concurrent claims for the same account", async () => {
    let linked: DotyposCustomerId | null = null;
    const shared = dependencies({
      findLink: () => Effect.sleep("1 millis").pipe(Effect.as(linked)),
      claimLink: (_accountId, requestedCustomerId) =>
        Effect.sync(() => {
          linked ??= requestedCustomerId;
          return { kind: "linked" as const, customerId: linked };
        }),
    });

    const results = await Effect.runPromise(
      Effect.all(
        [resolveCustomerAccount(shared), resolveCustomerAccount(shared)],
        { concurrency: "unbounded" }
      )
    );

    expect(results).toEqual([
      { accountId, dotyposCustomerId: customerId },
      { accountId, dotyposCustomerId: customerId },
    ]);
  });

  test.each([
    ["session", "authentication.session"],
    ["database", "account-link.read"],
    ["lookup", "dotypos.customer-lookup"],
    ["claim", "account-link.claim"],
    ["lock", "account-link.lock"],
  ] as const)("maps a %s provider failure to a sanitized unavailable cause", async (failure, code) => {
    const rawFailure = new Error("sensitive-provider-payload");
    const failed = Effect.fail(rawFailure);
    let overrides: Partial<CustomerAccountResolutionDependencies>;
    switch (failure) {
      case "session":
        overrides = {
          currentUser: () =>
            Effect.fail(customerAccountUnavailable("authentication.session")),
        };
        break;
      case "database":
        overrides = { findLink: () => failed };
        break;
      case "lookup":
        overrides = { findCustomer: () => failed };
        break;
      case "claim":
        overrides = { claimLink: () => failed };
        break;
      case "lock":
        overrides = { withAccountLock: () => failed };
        break;
    }

    const error = await runError(dependencies(overrides));
    expect(error).toMatchObject({ reason: "unavailable", cause: { code } });
    expect(censorLogValue(error)).toMatchObject({ cause: { code } });
    expect(JSON.stringify(error)).not.toContain("sensitive-provider-payload");
  });

  test("keeps account IDs opaque", () => {
    const otherAccountId = Schema.decodeUnknownSync(customerAccountIdSchema)(
      "auth-provider-value/with:no-assumed-format"
    );
    expect(otherAccountId).toBe("auth-provider-value/with:no-assumed-format");
  });
});
