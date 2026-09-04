import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  type CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import type { CustomerAccountActivityState } from "./customer-account-link.repository";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";
import { CustomerProfileService } from "./customer-profile.service";

const account = {
  accountId: customerAccountIdSchema.make("auth-user-1"),
  dotyposCustomerId: "60111",
};

const verifiedEmail = "ada@example.test";

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
  readonly accountState?: CustomerAccountActivityState;
  readonly link?: string | null;
  readonly profile?: typeof linkedProfile | null;
  readonly createdCustomerId?: string;
  readonly createdProfile?: typeof createdProfile;
  readonly claimedCustomerId?: string;
  readonly claimResult?: "linked" | "claimed";
}) => {
  const calls: string[] = [];
  const readCustomerIds: string[] = [];
  const updatePayloads: unknown[] = [];
  const createInputs: unknown[] = [];
  const state: CustomerAccountActivityState = fakes.accountState ?? {
    kind: "active",
    deletionRequestedAt: null,
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
    claim: () => {
      calls.push("claim");
      return Effect.succeed(
        fakes.claimResult === "claimed"
          ? ({ kind: "claimed" } as const)
          : ({
              kind: "linked",
              customerId:
                fakes.claimedCustomerId ?? fakes.createdCustomerId ?? "60111",
            } as const)
      );
    },
    withAccountLock: (_accountId, effect) => {
      calls.push("lock-acquire");
      return Effect.void.pipe(
        Effect.andThen(effect),
        Effect.ensuring(Effect.sync(() => calls.push("lock-release")))
      );
    },
  } satisfies Partial<CustomerAccountLinkRepository["Service"]>);

  const dotypos = Layer.mock(CustomerDotyposAdapter, {
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
    Layer.provide(Layer.mergeAll(links, dotypos))
  );
  return {
    service,
    calls,
    readCustomerIds,
    updatePayloads,
    createInputs,
  };
};

const runProfile = <A, E>(
  layers: ReturnType<typeof makeLayers>,
  run: (
    service: CustomerProfileService["Service"]
  ) => Effect.Effect<A, E, never>
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

    const blockedLayers = makeLayers({
      accountState: { kind: "active", deletionRequestedAt: new Date() },
    });
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
    const layers = makeLayers({ accountState: { kind: "missing" } });

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

  test("serializes updates under the account lock and never sends an email", async () => {
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

    expect(layers.calls[0]).toBe("lock-acquire");
    expect(layers.calls).toContain("update-profile");
    expect(layers.calls[layers.calls.length - 1]).toBe("lock-release");
    expect(JSON.stringify(layers.updatePayloads)).not.toContain("email");
    expect(layers.updatePayloads[0]).toMatchObject({ firstName: "Grace" });
  });

  test("creates the Dotypos profile with the verified email and claims the link", async () => {
    const layers = makeLayers({ createdCustomerId: "60999" });

    const profile = await runProfile(layers, (service) =>
      service.create(account.accountId, verifiedEmail, { firstName: "Nova" })
    );

    expect(profile).toEqual(createdProfile);
    expect(layers.createInputs[0]).toMatchObject({ email: verifiedEmail });
    expect(layers.calls.indexOf("create-profile")).toBeLessThan(
      layers.calls.indexOf("claim")
    );
  });

  test("returns the create-response profile for a fresh matching claim without a provider read", async () => {
    const layers = makeLayers({
      createdCustomerId: "60999",
      createdProfile,
    });

    const profile = await runProfile(layers, (service) =>
      service.create(account.accountId, verifiedEmail, { firstName: "Nova" })
    );

    expect(profile).toEqual(createdProfile);
    expect(layers.calls).not.toContain("read-profile");
    expect(layers.readCustomerIds).toEqual([]);
  });

  test("returns the support state when another account claimed the new profile", async () => {
    const layers = makeLayers({
      createdCustomerId: "60999",
      claimResult: "claimed",
    });

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CustomerProfileService;
        return yield* service.create(account.accountId, verifiedEmail, {
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

    const profile = await runProfile(layers, (service) =>
      service.create(account.accountId, verifiedEmail, { firstName: "Ada" })
    );

    expect(profile.firstName).toBe("Ada");
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

    const profile = await runProfile(layers, (service) =>
      service.create(account.accountId, verifiedEmail, { firstName: "Ada" })
    );

    expect(profile).toEqual(linkedProfile);
    expect(layers.calls).toContain("create-profile");
    expect(layers.calls).toContain("read-profile");
    expect(layers.readCustomerIds).toEqual(["60111"]);
  });
});
