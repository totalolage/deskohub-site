import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  type CreateHostedPaymentPageInput,
  ExternalAPIError,
  NetworkError,
  type NexiCardContract,
  type NexiContractId,
  type NexiCustomerId,
  type NexiOrderId,
  NexiService,
} from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import { customerAccountIdSchema } from "../../customer-account";
import { SavedCardService } from "./saved-card.service";
import { SavedCardContractRepository } from "./saved-card-contract.repository";
import { getSavedCardCustomerReference } from "./saved-card-customer-reference";

const sha256Hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const accountId = customerAccountIdSchema.make("auth-user-cards-1");
const otherAccountId = customerAccountIdSchema.make("auth-user-cards-2");
const account = { accountId, dotyposCustomerId: "60111" } as const;
const otherAccount = {
  accountId: otherAccountId,
  dotyposCustomerId: "60222",
} as const;
const locale = "en-US" as const;

const providerCustomerId = getSavedCardCustomerReference(accountId);
const otherProviderCustomerId = getSavedCardCustomerReference(otherAccountId);
const contractId = (suffix: string) => `dh${suffix}` as NexiContractId;
const orderId = (suffix: string) => `dhcard${suffix}` as NexiOrderId;

const citCard = (
  id: NexiContractId,
  extra: Partial<NexiCardContract> = {}
): NexiCardContract => ({
  contractId: id,
  contractType: "CIT",
  ...extra,
});

const mitCard = (id: NexiContractId): NexiCardContract => ({
  contractId: id,
  contractType: "MIT_UNSCHEDULED",
});

interface RepoState {
  enrollments: Array<{
    customerAccountId: string;
    orderId: string;
    providerCustomerId: string;
    providerContractId: string;
    securityTokenDigest: string;
    state: "pending" | "confirmed" | "failed" | "cancelled";
    failureCode: string | null;
    createdAt: Date;
  }>;
  contracts: Array<{
    customerAccountId: string;
    providerCustomerId: string;
    providerContractId: string;
    state: "active" | "removed";
    displayCircuit: string | null;
    displaySuffix: string | null;
  }>;
}

const makeState = (): RepoState => ({
  enrollments: [],
  contracts: [],
});

const makeRepositoryLayer = (state: RepoState) =>
  Layer.mock(SavedCardContractRepository, {
    findPendingEnrollment: (customerAccountId: string) =>
      Effect.succeed(
        state.enrollments.find(
          (row) =>
            row.customerAccountId === customerAccountId &&
            row.state === "pending"
        ) ?? null
      ),
    findEnrollmentByOrderId: (id: string) =>
      Effect.succeed(
        state.enrollments.find((row) => row.orderId === id) ?? null
      ),
    listEnrollments: (customerAccountId: string) =>
      Effect.succeed(
        state.enrollments.filter(
          (row) => row.customerAccountId === customerAccountId
        )
      ),
    createEnrollment: (input: {
      customerAccountId: string;
      orderId: string;
      providerCustomerId: string;
      providerContractId: string;
      securityTokenDigest: string;
    }) =>
      Effect.sync(() => {
        const row = {
          customerAccountId: input.customerAccountId,
          orderId: input.orderId,
          providerCustomerId: input.providerCustomerId,
          providerContractId: input.providerContractId,
          securityTokenDigest: input.securityTokenDigest,
          state: "pending" as const,
          failureCode: null,
          createdAt: new Date(),
        };
        state.enrollments.push(row);
        return row;
      }),
    refreshEnrollmentSecurityTokenDigest: (input: {
      orderId: string;
      customerAccountId: string;
      securityTokenDigest: string;
    }) =>
      Effect.sync(() => {
        const row = state.enrollments.find(
          (candidate) =>
            candidate.orderId === input.orderId &&
            candidate.customerAccountId === input.customerAccountId &&
            candidate.state === "pending"
        );
        if (row) row.securityTokenDigest = input.securityTokenDigest;
      }),
    transitionEnrollment: (input: {
      orderId: string;
      customerAccountId: string;
      state: "pending" | "confirmed" | "failed" | "cancelled";
      failureCode?: string;
    }) =>
      Effect.sync(() => {
        const row = state.enrollments.find(
          (candidate) =>
            candidate.orderId === input.orderId &&
            candidate.customerAccountId === input.customerAccountId &&
            candidate.state === "pending"
        );
        if (!row) return null;
        row.state = input.state;
        row.failureCode = input.failureCode ?? null;
        return row;
      }),
    confirmEnrollmentFromAnyState: (input: {
      orderId: string;
      customerAccountId: string;
    }) =>
      Effect.sync(() => {
        const row = state.enrollments.find(
          (candidate) =>
            candidate.orderId === input.orderId &&
            candidate.customerAccountId === input.customerAccountId
        );
        if (!row) return null;
        row.state = "confirmed";
        row.failureCode = null;
        return row;
      }),
    listActiveContracts: (customerAccountId: string) =>
      Effect.succeed(
        state.contracts.filter(
          (row) =>
            row.customerAccountId === customerAccountId &&
            row.state === "active"
        )
      ),
    findContract: (input: {
      customerAccountId: string;
      providerContractId: string;
    }) =>
      Effect.succeed(
        state.contracts.find(
          (row) =>
            row.customerAccountId === input.customerAccountId &&
            row.providerContractId === input.providerContractId
        ) ?? null
      ),
    upsertActiveContract: (input: {
      customerAccountId: string;
      providerCustomerId: string;
      providerContractId: string;
      displayCircuit?: string;
      displaySuffix?: string;
    }) =>
      Effect.sync(() => {
        const existing = state.contracts.find(
          (row) =>
            row.customerAccountId === input.customerAccountId &&
            row.providerContractId === input.providerContractId
        );
        if (existing) {
          existing.state = "active";
          existing.displayCircuit = input.displayCircuit ?? null;
          existing.displaySuffix = input.displaySuffix ?? null;
          return;
        }
        state.contracts.push({
          customerAccountId: input.customerAccountId,
          providerCustomerId: input.providerCustomerId,
          providerContractId: input.providerContractId,
          state: "active",
          displayCircuit: input.displayCircuit ?? null,
          displaySuffix: input.displaySuffix ?? null,
        });
      }),
    markContractRemoved: (input: {
      customerAccountId: string;
      providerContractId: string;
    }) =>
      Effect.sync(() => {
        const row = state.contracts.find(
          (candidate) =>
            candidate.customerAccountId === input.customerAccountId &&
            candidate.providerContractId === input.providerContractId &&
            candidate.state === "active"
        );
        if (row) row.state = "removed";
      }),
  } satisfies Partial<SavedCardContractRepository["Service"]>);

type NexiCalls = {
  hpp: Array<CreateHostedPaymentPageInput>;
  orders: Array<string>;
  lists: Array<string>;
  deactivations: Array<string>;
};

interface NexiConfig {
  readonly hppResult?: { securityToken: string };
  readonly hppError?: Error;
  readonly orders?: Record<
    string,
    {
      operations: Array<{
        orderId?: string;
        operationType?: string;
        operationResult?: string;
        amount?: string;
      }>;
    }
  >;
  readonly orderError?: Error;
  readonly contracts?: Record<string, readonly NexiCardContract[]>;
  readonly contractsError?: Error;
  readonly deactivationError?: Error;
  /** Simulates a deactivation that succeeds without list convergence. */
  readonly deactivationKeepsContract?: boolean;
}

const makeNexiLayer = (calls: NexiCalls, config: NexiConfig) => {
  // Mutable provider state: a successful deactivation removes the contract,
  // mirroring the provider's list-after-deactivation behavior.
  const providerLists: Record<string, NexiCardContract[]> = Object.fromEntries(
    Object.entries(config.contracts ?? {}).map(([customerId, contracts]) => [
      customerId,
      [...contracts],
    ])
  );
  return Layer.mock(NexiService, {
    createHostedPaymentPage: (input: CreateHostedPaymentPageInput) => {
      calls.hpp.push(input);
      if (config.hppError) return Effect.fail(config.hppError);
      return Effect.succeed({
        orderId: input.orderId,
        hostedPage: "https://hpp.example/verify",
        securityToken: config.hppResult?.securityToken ?? "token-1",
      });
    },
    getOrder: ({ orderId: id }: { orderId: string }) => {
      calls.orders.push(id);
      if (config.orderError) return Effect.fail(config.orderError);
      const order = config.orders?.[id];
      return order
        ? Effect.succeed({ orderId: id, operations: order.operations })
        : Effect.succeed({ orderId: id, operations: [] });
    },
    listCustomerContracts: ({ customerId }: { customerId: NexiCustomerId }) => {
      calls.lists.push(customerId);
      if (config.contractsError) return Effect.fail(config.contractsError);
      return Effect.succeed(providerLists[customerId] ?? []);
    },
    deactivateContract: ({ contractId: id }: { contractId: string }) => {
      calls.deactivations.push(id);
      if (config.deactivationError)
        return Effect.fail(config.deactivationError);
      if (config.deactivationKeepsContract) return Effect.void;
      for (const contracts of Object.values(providerLists)) {
        const index = contracts.findIndex(
          (contract) => contract.contractId === id
        );
        if (index >= 0) contracts.splice(index, 1);
      }
      return Effect.void;
    },
  } satisfies Partial<NexiService["Service"]>);
};

const emptyCalls = (): NexiCalls => ({
  hpp: [],
  orders: [],
  lists: [],
  deactivations: [],
});

const makeService = (
  state: RepoState = makeState(),
  calls: NexiCalls = emptyCalls(),
  config: NexiConfig = {}
) => ({
  run: <A>(
    effect: Effect.Effect<
      A,
      unknown,
      SavedCardService | SavedCardContractRepository
    >
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(
          SavedCardService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                makeNexiLayer(calls, config),
                makeRepositoryLayer(state)
              )
            )
          )
        ) as Effect.Effect<A, unknown, never>
      )
    ),
  state,
  calls,
});

const networkError = new NetworkError({ message: "network down" });
const serverError = new ExternalAPIError({
  service: "Nexi",
  operation: "op",
  message: "boom",
  statusCode: 503,
});

const authorizedVerificationOrder = (id: string) => ({
  [id]: {
    operations: [
      {
        orderId: id,
        operationType: "CARD_VERIFICATION",
        operationResult: "AUTHORIZED",
        amount: "0",
      },
    ],
  },
});

const cancelledVerificationOrder = (id: string) => ({
  [id]: {
    operations: [
      {
        orderId: id,
        operationType: "CARD_VERIFICATION",
        operationResult: "CANCELED",
        amount: "0",
      },
    ],
  },
});

const seedEnrollment = (
  state: RepoState,
  overrides: Partial<{
    customerAccountId: string;
    orderId: string;
    providerContractId: string;
    state: "pending" | "confirmed" | "failed" | "cancelled";
    failureCode: string | null;
  }> = {}
) => {
  const enrollment = {
    customerAccountId: overrides.customerAccountId ?? accountId,
    orderId: overrides.orderId ?? orderId("seed1"),
    providerCustomerId:
      overrides.customerAccountId === otherAccountId
        ? otherProviderCustomerId
        : providerCustomerId,
    providerContractId:
      overrides.providerContractId ?? contractId("seedcontract1"),
    securityTokenDigest: sha256Hex("token-1"),
    state: overrides.state ?? ("pending" as const),
    failureCode: overrides.failureCode ?? null,
    createdAt: new Date(),
  };
  state.enrollments.push(enrollment);
  return enrollment;
};

describe("SavedCardService.startEnrollment", () => {
  test("binds the account-scoped customer reference and stores the digest only", async () => {
    const { run, state, calls } = makeService(makeState(), undefined, {
      hppResult: { securityToken: "secret-token" },
    });

    const result = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.startEnrollment(account, locale)
      )
    );

    expect(result.status).toBe("redirect");
    expect(result.hostedPage).toContain("https://");

    const hppCall = calls.hpp[0];
    expect(hppCall.amount).toBe("0");
    expect(hppCall.actionType).toBe("VERIFY");
    expect(hppCall.customerReference).toBe(providerCustomerId);
    expect(hppCall.contractEnrollment).toEqual({
      contractId: expect.any(String),
      contractType: "CIT",
    });
    const contract = hppCall.contractEnrollment?.contractId ?? "";
    expect(contract.startsWith("dh")).toBe(true);
    expect(contract.length).toBeLessThanOrEqual(18);
    expect(hppCall.orderId.startsWith("dhcard")).toBe(true);
    expect(String(hppCall.orderId).length).toBeLessThanOrEqual(27);

    expect(state.enrollments).toHaveLength(1);
    const enrollment = state.enrollments[0];
    expect(enrollment.state).toBe("pending");
    expect(enrollment.customerAccountId).toBe(accountId);
    expect(enrollment.providerCustomerId).toBe(providerCustomerId);
    expect(enrollment.securityTokenDigest).toBe(sha256Hex("secret-token"));
    expect(JSON.stringify(state)).not.toContain("secret-token");
  });

  test("supersedes a stale pending enrollment", async () => {
    const state = makeState();
    const stale = seedEnrollment(state);
    stale.createdAt = new Date(Date.now() - 61 * 60 * 1000);

    const { run } = makeService(state);
    await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.startEnrollment(account, locale)
      )
    );

    expect(
      state.enrollments.find((row) => row.orderId === stale.orderId)?.state
    ).toBe("failed");
    expect(
      state.enrollments.find((row) => row.orderId === stale.orderId)
        ?.failureCode
    ).toBe("enrollment.superseded");
    expect(
      state.enrollments.filter((row) => row.state === "pending")
    ).toHaveLength(1);
  });

  test("reuses a fresh pending enrollment", async () => {
    const state = makeState();
    const fresh = seedEnrollment(state);

    const { run } = makeService(state);
    await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.startEnrollment(account, locale)
      )
    );

    expect(state.enrollments).toHaveLength(1);
    expect(state.enrollments[0].orderId).toBe(fresh.orderId);
    expect(state.enrollments[0].securityTokenDigest).toBe(sha256Hex("token-1"));
  });
});

describe("SavedCardService.verifyEnrollment", () => {
  test("confirms on authorized CARD_VERIFICATION plus provider CIT contract", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state, {
      orderId: orderId("verify1"),
      providerContractId: contractId("verifycontract"),
    });
    const { run, calls } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [
          citCard(contractId("verifycontract"), {
            circuit: "VISA",
            maskedInstrumentSuffix: "6152",
          }),
        ],
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment({ accountId, orderId: enrollment.orderId })
      )
    );
    expect(outcome).toBe("confirmed");

    expect(state.contracts).toEqual([
      {
        customerAccountId: accountId,
        providerCustomerId,
        providerContractId: enrollment.providerContractId,
        state: "active",
        displayCircuit: "VISA",
        displaySuffix: "6152",
      },
    ]);
    expect(state.enrollments[0].state).toBe("confirmed");
    expect(calls.lists).toContain(providerCustomerId);
  });

  test("a MIT provider entry never confirms: verification stays pending", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state);
    const { run } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [mitCard(enrollment.providerContractId)],
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment({ accountId, orderId: enrollment.orderId })
      )
    );

    expect(outcome).toBe("pending");
    expect(state.contracts).toHaveLength(0);
    expect(state.enrollments[0].state).toBe("pending");
  });

  test("rejects another account's orderId without info leak or state change", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state); // owned by account A
    const otherCalls = emptyCalls();
    const { run } = makeService(state, otherCalls, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [citCard(enrollment.providerContractId)],
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment({
          accountId: otherAccountId,
          orderId: enrollment.orderId,
        })
      )
    );

    expect(outcome).toBe("not_found");
    // No provider lookups, no state change, no contract registration.
    expect(otherCalls.orders).toHaveLength(0);
    expect(otherCalls.lists).toHaveLength(0);
    expect(state.enrollments[0].state).toBe("pending");
    expect(state.contracts).toHaveLength(0);
  });

  test("marks a declined order failed with a fixed code", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state);
    const { run } = makeService(state, undefined, {
      orders: {
        [enrollment.orderId]: {
          operations: [
            {
              orderId: enrollment.orderId,
              operationType: "CARD_VERIFICATION",
              operationResult: "THREEDS_FAILED",
              amount: "0",
            },
          ],
        },
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment({ accountId, orderId: enrollment.orderId })
      )
    );

    expect(outcome).toBe("failed");
    expect(state.enrollments[0].state).toBe("failed");
    expect(state.enrollments[0].failureCode).toBe("enrollment.failed");
  });

  test("a retryable provider failure leaves the enrollment pending", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state);
    const { run } = makeService(state, undefined, { orderError: networkError });

    await expect(
      run(
        Effect.flatMap(SavedCardService, (service) =>
          service.verifyEnrollment({ accountId, orderId: enrollment.orderId })
        )
      )
    ).rejects.toMatchObject({ code: "unavailable" });

    expect(state.enrollments[0].state).toBe("pending");
  });

  test("late success recovers a cancelled enrollment", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state, {
      state: "cancelled",
      failureCode: "enrollment.cancelled",
    });
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: enrollment.providerContractId,
      state: "removed",
      displayCircuit: null,
      displaySuffix: null,
    });
    const { run } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [
          citCard(enrollment.providerContractId, { circuit: "MC" }),
        ],
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment({ accountId, orderId: enrollment.orderId })
      )
    );

    expect(outcome).toBe("confirmed");
    expect(state.enrollments[0].state).toBe("confirmed");
    expect(state.enrollments[0].failureCode).toBeNull();
    expect(state.contracts[0].state).toBe("active");
  });

  test("late success recovers a superseded enrollment", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state, {
      state: "failed",
      failureCode: "enrollment.superseded",
    });
    const { run } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [citCard(enrollment.providerContractId)],
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment({ accountId, orderId: enrollment.orderId })
      )
    );

    expect(outcome).toBe("confirmed");
    expect(state.enrollments[0].state).toBe("confirmed");
    expect(state.enrollments[0].failureCode).toBeNull();
  });

  test("provider-terminal outcome keeps a cancelled enrollment terminal", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state, {
      state: "cancelled",
      failureCode: "enrollment.cancelled",
    });
    const { run } = makeService(state, undefined, {
      orders: cancelledVerificationOrder(enrollment.orderId),
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment({ accountId, orderId: enrollment.orderId })
      )
    );

    expect(outcome).toBe("cancelled");
    expect(state.enrollments[0].state).toBe("cancelled");
    expect(state.enrollments[0].failureCode).toBe("enrollment.cancelled");
  });
});

describe("SavedCardService.reconcileEnrollmentByOrderId (webhook)", () => {
  test("absent token rejects without mutations or provider calls", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state);
    const calls = emptyCalls();
    const { run } = makeService(state, calls, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [citCard(enrollment.providerContractId)],
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.reconcileEnrollmentByOrderId(enrollment.orderId, undefined)
      )
    );

    expect(outcome).toBe("not_found");
    expect(calls.orders).toHaveLength(0);
    expect(calls.lists).toHaveLength(0);
    expect(state.enrollments[0].state).toBe("pending");
    expect(state.contracts).toHaveLength(0);
  });

  test("wrong token rejects without mutations or provider calls", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state);
    const calls = emptyCalls();
    const { run } = makeService(state, calls);

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.reconcileEnrollmentByOrderId(enrollment.orderId, "wrong-token")
      )
    );

    expect(outcome).toBe("not_found");
    expect(calls.orders).toHaveLength(0);
    expect(calls.lists).toHaveLength(0);
    expect(state.enrollments[0].state).toBe("pending");
  });

  test("terminal enrollment with a wrong token is still rejected", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state, {
      state: "cancelled",
      failureCode: "enrollment.cancelled",
    });
    const calls = emptyCalls();
    const { run } = makeService(state, calls);

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.reconcileEnrollmentByOrderId(enrollment.orderId, "wrong-token")
      )
    );

    expect(outcome).toBe("not_found");
    expect(calls.orders).toHaveLength(0);
    expect(state.enrollments[0].state).toBe("cancelled");
  });

  test("terminal enrollment with the correct token reconciles", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state, {
      state: "cancelled",
      failureCode: "enrollment.cancelled",
    });
    const { run, calls } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [citCard(enrollment.providerContractId)],
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.reconcileEnrollmentByOrderId(enrollment.orderId, "token-1")
      )
    );

    expect(outcome).toBe("confirmed");
    expect(calls.orders).toContain(enrollment.orderId);
    expect(state.enrollments[0].state).toBe("confirmed");
  });
});

describe("SavedCardService.cancelEnrollment", () => {
  test("cancels a still-pending enrollment for the owning account", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state);
    const { run } = makeService(state);

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.cancelEnrollment({ accountId, orderId: enrollment.orderId })
      )
    );

    expect(outcome).toBe("cancelled");
    expect(state.enrollments[0].failureCode).toBe("enrollment.cancelled");
  });

  test("another account's orderId yields not_found without mutation", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state); // account A's row
    const { run } = makeService(state);

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.cancelEnrollment({
          accountId: otherAccountId,
          orderId: enrollment.orderId,
        })
      )
    );

    expect(outcome).toBe("not_found");
    expect(state.enrollments[0].state).toBe("pending");
  });

  test("provider success beats a local cancellation", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state);
    const { run } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [citCard(enrollment.providerContractId)],
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.cancelEnrollment({ accountId, orderId: enrollment.orderId })
      )
    );

    expect(outcome).toBe("confirmed");
    expect(state.enrollments[0].state).toBe("confirmed");
  });
});

describe("SavedCardService.listCards", () => {
  test("shows only the provider ∩ local intersection and drops stale rows", async () => {
    const state = makeState();
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("seedcontract1"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("aaa"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("zzz"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });

    const { run } = makeService(state, undefined, {
      contracts: {
        [providerCustomerId]: [
          citCard(contractId("zzz"), {
            circuit: "MC",
            maskedInstrumentSuffix: "1111",
          }),
          citCard(contractId("aaa")),
        ],
      },
    });

    const cards = await run(
      Effect.flatMap(SavedCardService, (service) => service.listCards(account))
    );

    expect(cards).toEqual([
      { contractId: contractId("aaa") },
      { contractId: contractId("zzz"), circuit: "MC", suffix: "1111" },
    ]);
    expect(
      state.contracts.find(
        (row) => row.providerContractId === "dhseedcontract1"
      )?.state
    ).toBe("removed");
  });

  test("a MIT contract is never displayed", async () => {
    const state = makeState();
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("mitrow"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });

    const { run } = makeService(state, undefined, {
      contracts: {
        [providerCustomerId]: [mitCard(contractId("mitrow"))],
      },
    });

    const cards = await run(
      Effect.flatMap(SavedCardService, (service) => service.listCards(account))
    );

    expect(cards).toEqual([]);
    expect(state.contracts[0].state).toBe("removed");
  });

  test("reconciles a pending enrollment whose provider flow already completed", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state);
    const { run } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [
          citCard(enrollment.providerContractId, {
            circuit: "VISA",
            maskedInstrumentSuffix: "4242",
          }),
        ],
      },
    });

    const cards = await run(
      Effect.flatMap(SavedCardService, (service) => service.listCards(account))
    );

    expect(cards).toEqual([
      {
        contractId: enrollment.providerContractId,
        circuit: "VISA",
        suffix: "4242",
      },
    ]);
    expect(state.enrollments[0].state).toBe("confirmed");
    expect(state.contracts[0].state).toBe("active");
  });

  test("fails closed on a retryable provider failure", async () => {
    const state = makeState();
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("aaa"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });
    const { run } = makeService(state, undefined, {
      contractsError: serverError,
    });

    await expect(
      run(
        Effect.flatMap(SavedCardService, (service) =>
          service.listCards(account)
        )
      )
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("SavedCardService.removeCard", () => {
  test("one account cannot list or remove another account's card", async () => {
    const state = makeState();
    seedEnrollment(state, {
      customerAccountId: otherAccountId,
      providerContractId: contractId("ofa"),
    });
    state.contracts.push({
      customerAccountId: otherAccountId,
      providerCustomerId: otherProviderCustomerId,
      providerContractId: contractId("ofa"),
      state: "active",
      displayCircuit: "VISA",
      displaySuffix: "4242",
    });

    const { run, calls } = makeService(state, undefined, {
      contracts: {
        [otherProviderCustomerId]: [
          citCard(contractId("ofa"), { circuit: "VISA" }),
        ],
      },
    });

    const otherCards = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.listCards(otherAccount)
      )
    );
    expect(otherCards).toHaveLength(1);

    const result = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.removeCard(account, contractId("ofa"))
      )
    );
    expect(result).toEqual({ status: "removed" });
    expect(calls.deactivations).toHaveLength(0);
    expect(state.contracts[0].state).toBe("active");
    expect(state.contracts[0].customerAccountId).toBe(otherAccountId);
  });

  test("treats a provider-missing contract as already removed", async () => {
    const state = makeState();
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("gone"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });
    const { run, calls } = makeService(state, undefined, {
      contracts: { [providerCustomerId]: [] },
    });

    const result = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.removeCard(account, contractId("gone"))
      )
    );

    expect(result).toEqual({ status: "removed" });
    expect(calls.deactivations).toHaveLength(0);
    expect(state.contracts[0].state).toBe("removed");
  });

  test("tolerates a deactivation 404 and marks the row removed", async () => {
    const state = makeState();
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("nf"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });
    const { run } = makeService(state, undefined, {
      contracts: {
        [providerCustomerId]: [citCard(contractId("nf"))],
      },
      deactivationError: new ExternalAPIError({
        service: "Nexi",
        operation: "op",
        message: "not found",
        statusCode: 404,
      }),
    });

    const result = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.removeCard(account, contractId("nf"))
      )
    );

    expect(result).toEqual({ status: "removed" });
    expect(state.contracts[0].state).toBe("removed");
  });

  test("a retryable deactivation failure keeps the card active", async () => {
    const state = makeState();
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("stuck"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });
    const { run } = makeService(state, undefined, {
      contracts: {
        [providerCustomerId]: [citCard(contractId("stuck"))],
      },
      deactivationError: networkError,
    });

    await expect(
      run(
        Effect.flatMap(SavedCardService, (service) =>
          service.removeCard(account, contractId("stuck"))
        )
      )
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(state.contracts[0].state).toBe("active");
  });
});

describe("SavedCardService.deactivateAllForDeletion", () => {
  test("an in-flight pending enrollment blocks the deletion retryably", async () => {
    const state = makeState();
    seedEnrollment(state); // pending, provider indeterminate
    const calls = emptyCalls();
    const { run } = makeService(state, calls);

    await expect(
      run(
        Effect.flatMap(SavedCardService, (service) =>
          service.deactivateAllForDeletion(accountId)
        )
      )
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(calls.deactivations).toHaveLength(0);
  });

  test("late-success reconciliation registers the contract and deactivates it", async () => {
    const state = makeState();
    const enrollment = seedEnrollment(state, {
      state: "cancelled",
      failureCode: "enrollment.cancelled",
    });
    const { run, calls } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [citCard(enrollment.providerContractId)],
      },
    });

    await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.deactivateAllForDeletion(accountId)
      )
    );

    expect(state.enrollments[0].state).toBe("confirmed");
    expect(state.contracts[0].state).toBe("removed");
    expect(calls.deactivations).toEqual([enrollment.providerContractId]);
  });

  test("blocks on retryable failure and resumes afterwards", async () => {
    const state = makeState();
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("del1"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("del2"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });

    const failing = makeService(state, undefined, {
      contracts: { [providerCustomerId]: [] },
      deactivationError: networkError,
    });
    await expect(
      failing.run(
        Effect.flatMap(SavedCardService, (service) =>
          service.deactivateAllForDeletion(accountId)
        )
      )
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(failing.state.contracts.every((row) => row.state === "active")).toBe(
      true
    );

    const resuming = makeService(failing.state, undefined, {
      contracts: { [providerCustomerId]: [] },
    });
    await resuming.run(
      Effect.flatMap(SavedCardService, (service) =>
        service.deactivateAllForDeletion(accountId)
      )
    );
    expect(
      resuming.state.contracts.every((row) => row.state === "removed")
    ).toBe(true);
  });

  test("confirms success only when the provider list is empty", async () => {
    const state = makeState();
    state.contracts.push({
      customerAccountId: accountId,
      providerCustomerId,
      providerContractId: contractId("del9"),
      state: "active",
      displayCircuit: null,
      displaySuffix: null,
    });

    // Deactivation "succeeds" but the final re-read still returns the
    // contract: the deletion must stay blocked.
    const stuck = makeService(state, undefined, {
      contracts: {
        [providerCustomerId]: [citCard(contractId("del9"))],
      },
      deactivationKeepsContract: true,
    });
    await expect(
      stuck.run(
        Effect.flatMap(SavedCardService, (service) =>
          service.deactivateAllForDeletion(accountId)
        )
      )
    ).rejects.toMatchObject({ code: "unavailable" });

    const cleared = makeService(state, undefined, {
      contracts: { [providerCustomerId]: [] },
    });
    await cleared.run(
      Effect.flatMap(SavedCardService, (service) =>
        service.deactivateAllForDeletion(accountId)
      )
    );
    expect(cleared.state.contracts[0].state).toBe("removed");
  });

  test("deactivates MIT contracts during deletion", async () => {
    const state = makeState();
    const { run, calls } = makeService(state, undefined, {
      contracts: {
        [providerCustomerId]: [
          mitCard(contractId("mit1")),
          citCard(contractId("cit1")),
        ],
      },
    });

    await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.deactivateAllForDeletion(accountId)
      )
    );

    expect(calls.deactivations).toEqual([
      contractId("cit1"),
      contractId("mit1"),
    ]);
  });
});
