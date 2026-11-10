import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import { NoReviewAccounts } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import type { CustomerAccountAccessError } from "../customer-account";
import type { CustomerAccountActivityState } from "./customer-account-link.repository";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAccountSections } from "./customer-account-sections";
import {
  makeCustomerAccountSections,
  sectionAccountId,
  sectionAccountEmail as verifiedEmail,
} from "./customer-account-sections.test-utils";
import {
  CustomerDotyposAdapter,
  type ExactEmailCustomerMatch,
} from "./customer-dotypos-adapter.service";
import { CustomerProfileService } from "./customer-profile.service";

const account = {
  accountId: sectionAccountId,
  dotyposCustomerId: "60111",
};

const linkedProfile = {
  firstName: "Ada",
  lastName: "Lovelace" as const,
  phone: null,
  billing: null,
};

const createdProfile = {
  firstName: "Nova",
  lastName: null,
  phone: null,
  billing: null,
};

const makeLayers = (fakes: {
  /** The account's authoritative state, read by the section and by `load`. */
  readonly accountState?: "active" | "deletion-requested" | "missing";
  /** Fails taking the account lock. */
  readonly lockUnavailable?: boolean;
  readonly link?: string | null;
  readonly profile?: typeof linkedProfile | null;
  readonly createdCustomerId?: string;
  readonly createdProfile?: typeof createdProfile;
  readonly claimedCustomerId?: string;
  readonly claimResult?: "linked" | "claimed";
  /**
   * The exact-email Dotypos match for the login email. By default Dotypos
   * holds no such customer until this test creates one, which it then finds.
   */
  readonly emailMatch?: ExactEmailCustomerMatch;
  /** How many link writes fail before they succeed. */
  readonly claimFailures?: number;
}) => {
  // The section records its lock and recheck events into the same list, so
  // each step's order relative to the lock is observable.
  const sections = makeCustomerAccountSections({
    activityState: fakes.accountState ?? "active",
    lockUnavailable: fakes.lockUnavailable,
  });
  const calls = sections.events;
  const claimedCustomerIds: string[] = [];
  let remainingClaimFailures = fakes.claimFailures ?? 0;
  const readCustomerIds: string[] = [];
  const updatePayloads: unknown[] = [];
  const createInputs: unknown[] = [];
  const state: CustomerAccountActivityState =
    fakes.accountState === "missing"
      ? { kind: "missing" }
      : {
          kind: "active",
          email: verifiedEmail,
          deletionRequestedAt:
            fakes.accountState === "deletion-requested" ? new Date() : null,
        };

  const links = Layer.mock(CustomerAccountLinkRepository, {
    findActivityState: () => {
      calls.push("deletion-state");
      return Effect.succeed(state);
    },
    find: () => {
      calls.push("find-link");
      return Effect.succeed(fakes.link ?? null);
    },
    claim: (_accountId, customerId) => {
      calls.push("claim");
      if (remainingClaimFailures > 0) {
        remainingClaimFailures -= 1;
        return Effect.fail(
          new SqlError.SqlError({
            reason: new SqlError.UnknownError({
              cause: new Error("synthetic link write failure"),
              message: "synthetic link write failure",
              operation: "claim",
            }),
          })
        );
      }
      claimedCustomerIds.push(customerId);
      return Effect.succeed(
        fakes.claimResult === "claimed"
          ? ({ kind: "claimed" } as const)
          : ({
              kind: "linked",
              customerId: fakes.claimedCustomerId ?? customerId,
              created: fakes.claimedCustomerId === undefined,
            } as const)
      );
    },
  } satisfies Partial<CustomerAccountLinkRepository["Service"]>);

  const dotypos = Layer.mock(CustomerDotyposAdapter, {
    classifyExactEmailCustomers: () => {
      calls.push("classify-email");
      if (fakes.emailMatch) return Effect.succeed(fakes.emailMatch);
      return Effect.succeed(
        createInputs.length === 0
          ? ({ kind: "not-found" } as const)
          : ({
              kind: "matched",
              state: "active",
              customerId: fakes.createdCustomerId ?? "60111",
            } as const)
      );
    },
    reactivateCustomer: () => {
      calls.push("reactivate");
      return Effect.void;
    },
    readCustomerProfile: (customerId) => {
      calls.push("read-profile");
      readCustomerIds.push(customerId);
      return Effect.succeed(fakes.profile ?? linkedProfile);
    },
    updateCustomerProfile: (_customerId, profile) => {
      calls.push("update-profile");
      updatePayloads.push(profile);
      return Effect.void;
    },
    createCustomerProfile: (input) => {
      calls.push("create-profile");
      createInputs.push(input);
      return Effect.succeed({
        customerId: fakes.createdCustomerId ?? "60111",
        profile: fakes.createdProfile ?? createdProfile,
      });
    },
  } satisfies Partial<CustomerDotyposAdapter["Service"]>);

  const service = CustomerProfileService.Default.pipe(
    Layer.provide(Layer.mergeAll(links, dotypos, NoReviewAccounts)),
    Layer.provideMerge(sections.layer)
  );
  return {
    service,
    calls,
    claimedCustomerIds,
    readCustomerIds,
    updatePayloads,
    createInputs,
  };
};

const runProfile = <A, E>(
  layers: ReturnType<typeof makeLayers>,
  run: (
    service: CustomerProfileService["Service"]
  ) => Effect.Effect<A, E, CustomerAccountSections>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* CustomerProfileService;
      return yield* run(service);
    }).pipe(Effect.provide(layers.service))
  );

describe("CustomerProfileService", () => {
  test("loads the Dotypos-owned profile and blocks on a deletion marker", async () => {
    const layers = makeLayers({});

    const profile = await runProfile(layers, (service) =>
      service.load(account)
    );
    expect(profile.firstName).toBe("Ada");

    const blockedLayers = makeLayers({ accountState: "deletion-requested" });
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CustomerProfileService;
        return yield* service.load(account);
      }).pipe(Effect.provide(blockedLayers.service), Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const error = outcome.failure as CustomerAccountAccessError;
      expect(error.reason).toBe("link-required");
      expect(error.linkReason).toBe("deletion-requested");
    }
  });

  test("stops already-authorized work when the auth account row is gone", async () => {
    const layers = makeLayers({ accountState: "missing" });

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CustomerProfileService;
        return yield* service.update(account, { firstName: "Grace" });
      }).pipe(Effect.provide(layers.service), Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const error = outcome.failure as CustomerAccountAccessError;
      expect(error.reason).toBe("unauthenticated");
    }
    expect(layers.calls).not.toContain("update-profile");
  });

  test("serializes updates under the account lock", async () => {
    const layers = makeLayers({});

    await runProfile(layers, (service) =>
      service.update(account, {
        firstName: "Grace",
        lastName: "Hopper",
        phone: "+420601111222",
        billing: {
          kind: "business",
          companyName: "UNIVAC",
          companyId: "1",
          vatId: "CZ1",
          addressLine1: "Main Street 1",
        },
      })
    );

    expect(layers.calls).toEqual([
      "account-lock-acquired",
      "account-activity",
      "update-profile",
      "read-profile",
      "account-lock-released",
    ]);
    expect(layers.updatePayloads[0]).toMatchObject({ firstName: "Grace" });
  });

  test("reports an update whose account lock can't be taken as the fixed lock unavailability", async () => {
    const layers = makeLayers({ lockUnavailable: true });

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CustomerProfileService;
        return yield* service.update(account, { firstName: "Grace" });
      }).pipe(Effect.provide(layers.service), Effect.result)
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { reason: "unavailable", cause: { code: "account-link.lock" } },
    });
    expect(layers.calls).not.toContain("update-profile");
  });

  test("creates the Dotypos profile with the verified email and claims the link without a provider read", async () => {
    const layers = makeLayers({ createdCustomerId: "60999" });

    const creation = await runProfile(layers, (service) =>
      service.create(account.accountId, { firstName: "Nova" })
    );

    expect(creation).toEqual({
      account: { accountId: account.accountId, dotyposCustomerId: "60999" },
      profile: createdProfile,
      created: true,
    });
    expect(layers.createInputs[0]).toMatchObject({ email: verifiedEmail });
    expect(layers.calls.indexOf("create-profile")).toBeLessThan(
      layers.calls.indexOf("claim")
    );
    expect(layers.calls).not.toContain("read-profile");
    expect(layers.readCustomerIds).toEqual([]);
  });

  test("creates the profile under the account lock", async () => {
    const layers = makeLayers({ createdCustomerId: "60999" });

    await runProfile(layers, (service) =>
      service.create(account.accountId, { firstName: "Nova" })
    );

    expect(layers.calls).toEqual([
      "account-lock-acquired",
      "account-activity",
      "find-link",
      "classify-email",
      "create-profile",
      "claim",
      "account-lock-released",
    ]);
  });

  test("creates the profile under an enclosing section's hold without a second lock or recheck", async () => {
    const layers = makeLayers({ createdCustomerId: "60999" });

    const creation = await runProfile(layers, (service) =>
      Effect.flatMap(Effect.service(CustomerAccountSections), (sections) =>
        sections.withActiveAccount(
          account.accountId,
          service.create(account.accountId, {
            firstName: "Nova",
            phone: "+420601111222",
          }),
          { recheck: "active" }
        )
      )
    );

    expect(creation).toEqual({
      account: { accountId: account.accountId, dotyposCustomerId: "60999" },
      profile: createdProfile,
      created: true,
    });
    expect(layers.createInputs).toEqual([
      {
        email: verifiedEmail,
        profile: { firstName: "Nova", phone: "+420601111222" },
      },
    ]);
    expect(layers.calls).toEqual([
      "account-lock-acquired",
      "account-activity",
      "find-link",
      "classify-email",
      "create-profile",
      "claim",
      "account-lock-released",
    ]);
  });

  test("stops creating once the account has requested deletion", async () => {
    const layers = makeLayers({ accountState: "deletion-requested" });

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CustomerProfileService;
        return yield* service.create(account.accountId, { firstName: "Nova" });
      }).pipe(Effect.provide(layers.service), Effect.result)
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { reason: "link-required", linkReason: "deletion-requested" },
    });
    expect(layers.calls).toEqual([
      "account-lock-acquired",
      "account-activity",
      "account-lock-released",
    ]);
  });

  test("returns the support state when another account claimed the new profile", async () => {
    const layers = makeLayers({
      createdCustomerId: "60999",
      claimResult: "claimed",
    });

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CustomerProfileService;
        return yield* service.create(account.accountId, {
          firstName: "Ada",
        });
      }).pipe(Effect.provide(layers.service), Effect.result)
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const error = outcome.failure as CustomerAccountAccessError;
      expect(error.reason).toBe("link-required");
      expect(error.linkReason).toBe("claimed");
    }
  });

  test("returns the linked profile without provider creation when a link already exists", async () => {
    const layers = makeLayers({ link: "60111" });

    const creation = await runProfile(layers, (service) =>
      service.create(account.accountId, { firstName: "Ada" })
    );

    expect(creation.profile.firstName).toBe("Ada");
    expect(creation.created).toBe(false);
    expect(layers.calls.indexOf("find-link")).toBeGreaterThan(-1);
    expect(layers.calls.indexOf("find-link")).toBeLessThan(
      layers.calls.indexOf("read-profile")
    );
    expect(layers.calls).not.toContain("create-profile");
    expect(layers.calls).not.toContain("claim");
    expect(layers.readCustomerIds).toEqual(["60111"]);
  });

  test("reads the claimed link customer instead of the created id after a raced claim", async () => {
    const layers = makeLayers({
      createdCustomerId: "60999",
      claimedCustomerId: "60111",
    });

    const creation = await runProfile(layers, (service) =>
      service.create(account.accountId, { firstName: "Ada" })
    );

    expect(creation).toEqual({
      account: { accountId: account.accountId, dotyposCustomerId: "60111" },
      profile: linkedProfile,
      created: false,
    });
    expect(layers.calls).toContain("create-profile");
    expect(layers.calls).toContain("read-profile");
    expect(layers.readCustomerIds).toEqual(["60111"]);
  });
  test.each([
    ["active", ["classify-email", "claim", "read-profile"]],
    ["expired", ["classify-email", "reactivate", "claim", "read-profile"]],
  ] as const)(
    "links the %s exact-email customer instead of creating another one",
    async (state, steps) => {
      const layers = makeLayers({
        emailMatch: { kind: "matched", state, customerId: "60500" },
      });

      const creation = await runProfile(layers, (service) =>
        service.create(account.accountId, {
          firstName: "Nova",
        })
      );

      // The customer's saved profile wins over the submitted one.
      expect(creation).toEqual({
        account: { accountId: account.accountId, dotyposCustomerId: "60500" },
        profile: linkedProfile,
        created: true,
      });
      expect(layers.calls).toEqual([
        "account-lock-acquired",
        "account-activity",
        "find-link",
        ...steps,
        "account-lock-released",
      ]);
      expect(layers.createInputs).toEqual([]);
      expect(layers.updatePayloads).toEqual([]);
    }
  );

  test("a retry after the link write failed links the customer the first attempt created", async () => {
    const layers = makeLayers({ createdCustomerId: "60999", claimFailures: 1 });
    const create = () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomerProfileService;
          return yield* service.create(account.accountId, {
            firstName: "Nova",
          });
        }).pipe(Effect.provide(layers.service), Effect.result)
      );

    expect(await create()).toMatchObject({
      _tag: "Failure",
      failure: { reason: "unavailable" },
    });
    expect(await create()).toMatchObject({
      _tag: "Success",
      success: {
        account: { accountId: account.accountId, dotyposCustomerId: "60999" },
        created: true,
      },
    });
    expect(layers.createInputs).toHaveLength(1);
    expect(layers.claimedCustomerIds).toEqual(["60999"]);
  });

  test.each(["ambiguous", "unusable"] as const)(
    "returns the %s support state without creating a customer",
    async (kind) => {
      const layers = makeLayers({ emailMatch: { kind } });

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomerProfileService;
          return yield* service.create(account.accountId, {
            firstName: "Nova",
          });
        }).pipe(Effect.provide(layers.service), Effect.result)
      );

      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { reason: "link-required", linkReason: kind },
      });
      expect(layers.calls).not.toContain("create-profile");
      expect(layers.calls).not.toContain("claim");
    }
  );

  test("returns the claimed support state when another account holds the exact-email customer", async () => {
    const layers = makeLayers({
      emailMatch: { kind: "matched", state: "active", customerId: "60500" },
      claimResult: "claimed",
    });

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CustomerProfileService;
        return yield* service.create(account.accountId, { firstName: "Nova" });
      }).pipe(Effect.provide(layers.service), Effect.result)
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { reason: "link-required", linkReason: "claimed" },
    });
    expect(layers.calls).not.toContain("create-profile");
  });
});
