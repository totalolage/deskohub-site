import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  type CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
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

const makeLayers = (fakes: {
  readonly deletionRequestedAt?: Date | null;
  readonly link?: string | null;
  readonly profile?: typeof linkedProfile | null;
  readonly createdCustomerId?: string;
  readonly claimResult?: "linked" | "claimed";
}) => {
  const calls: string[] = [];
  const updatePayloads: unknown[] = [];
  const createInputs: unknown[] = [];

  const links = Layer.mock(CustomerAccountLinkRepository, {
    findDeletionRequestedAt: () => {
      calls.push("deletion-state");
      return Effect.succeed(fakes.deletionRequestedAt ?? null);
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
              customerId: fakes.createdCustomerId ?? "60111",
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
    readCustomerProfile: () => {
      calls.push("read-profile");
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
      return Effect.succeed(fakes.createdCustomerId ?? "60111");
    },
  } satisfies Partial<CustomerDotyposAdapter["Service"]>);

  const service = CustomerProfileService.Default.pipe(
    Layer.provide(Layer.mergeAll(links, dotypos))
  );
  return { service, calls, updatePayloads, createInputs };
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

    const blockedLayers = makeLayers({ deletionRequestedAt: new Date() });
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
      service.create(account.accountId, verifiedEmail, { firstName: "Ada" })
    );

    expect(profile.firstName).toBe("Ada");
    expect(layers.createInputs[0]).toMatchObject({ email: verifiedEmail });
    expect(layers.calls.indexOf("create-profile")).toBeLessThan(
      layers.calls.indexOf("claim")
    );
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
});
