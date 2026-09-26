import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
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
import {
  type NewSavedCardEnrollment,
  SavedCardContractRepository,
} from "./saved-card-contract.repository";
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
    createEnrollment: (input: NewSavedCardEnrollment) =>
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
}

const makeNexiLayer = (calls: NexiCalls, config: NexiConfig) =>
  Layer.mock(NexiService, {
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
      return Effect.succeed(config.contracts?.[customerId] ?? []);
    },
    deactivateContract: ({ contractId: id }: { contractId: string }) => {
      calls.deactivations.push(id);
      if (config.deactivationError)
        return Effect.fail(config.deactivationError);
      return Effect.void;
    },
  } satisfies Partial<NexiService["Service"]>);

const makeService = (
  state = makeState(),
  calls: NexiCalls = {
    hpp: [],
    orders: [],
    lists: [],
    deactivations: [],
  },
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

const seedConfirmedEnrollment = (
  state: RepoState,
  overrides: Partial<{
    customerAccountId: string;
    orderId: string;
    providerContractId: string;
  }> = {}
) => {
  const enrollment = {
    customerAccountId: overrides.customerAccountId ?? accountId,
    orderId: overrides.orderId ?? orderId("seed1"),
    providerCustomerId,
    providerContractId:
      overrides.providerContractId ?? contractId("seedcontract1"),
    securityTokenDigest: sha256Hex("token-1"),
    state: "pending" as const,
    failureCode: null,
    createdAt: new Date(),
  };
  state.enrollments.push(enrollment);
  return enrollment;
};

describe("SavedCardService", () => {
  test("startEnrollment creates a VERIFY session and stores the digest only", async () => {
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
    expect(hppCall.contractEnrollment).toEqual({
      contractId: expect.any(String),
      contractType: "CIT",
    });
    const contract = (hppCall.contractEnrollment as { contractId: string })
      .contractId;
    expect(contract.startsWith("dh")).toBe(true);
    expect(contract.length).toBeLessThanOrEqual(18);
    expect(hppCall.orderId.startsWith("dhcard")).toBe(true);
    expect(String(hppCall.orderId).length).toBeLessThanOrEqual(27);

    expect(state.enrollments).toHaveLength(1);
    const enrollment = state.enrollments[0];
    expect(enrollment.state).toBe("pending");
    expect(enrollment.customerAccountId).toBe(accountId);
    expect(enrollment.securityTokenDigest).toBe(sha256Hex("secret-token"));
    expect(JSON.stringify(state)).not.toContain("secret-token");
  });

  test("startEnrollment supersedes a stale pending enrollment", async () => {
    const state = makeState();
    const stale = seedConfirmedEnrollment(state);
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

  test("startEnrollment reuses a fresh pending enrollment", async () => {
    const state = makeState();
    const fresh = seedConfirmedEnrollment(state);

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

  test("verification confirms on authorized CARD_VERIFICATION plus provider contract", async () => {
    const state = makeState();
    const enrollment = seedConfirmedEnrollment(state, {
      orderId: orderId("verify1"),
      providerContractId: contractId("verifycontract"),
    });
    const { run, calls } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: {
        [providerCustomerId]: [
          {
            contractId: enrollment.providerContractId,
            circuit: "VISA",
            maskedInstrumentSuffix: "6152",
          },
        ],
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment(enrollment.orderId)
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

  test("verification rejects a mismatched presented security token", async () => {
    const state = makeState();
    const enrollment = seedConfirmedEnrollment(state);
    const { run, calls } = makeService(state);

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment(enrollment.orderId, "wrong-token")
      )
    );

    expect(outcome).toBe("not_found");
    expect(calls.orders).toHaveLength(0);
    expect(state.enrollments[0].state).toBe("pending");
  });

  test("verification marks a declined order failed with a fixed code", async () => {
    const state = makeState();
    const enrollment = seedConfirmedEnrollment(state);
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
        service.verifyEnrollment(enrollment.orderId)
      )
    );

    expect(outcome).toBe("failed");
    expect(state.enrollments[0].state).toBe("failed");
    expect(state.enrollments[0].failureCode).toBe("enrollment.failed");
  });

  test("verification marks a cancelled order cancelled", async () => {
    const state = makeState();
    const enrollment = seedConfirmedEnrollment(state);
    const { run } = makeService(state, undefined, {
      orders: {
        [enrollment.orderId]: {
          operations: [
            {
              orderId: enrollment.orderId,
              operationType: "CARD_VERIFICATION",
              operationResult: "CANCELED",
              amount: "0",
            },
          ],
        },
      },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment(enrollment.orderId)
      )
    );

    expect(outcome).toBe("cancelled");
    expect(state.enrollments[0].failureCode).toBe("enrollment.cancelled");
  });

  test("a retryable provider failure leaves the enrollment pending", async () => {
    const state = makeState();
    const enrollment = seedConfirmedEnrollment(state);
    const { run } = makeService(state, undefined, { orderError: networkError });

    await expect(
      run(
        Effect.flatMap(SavedCardService, (service) =>
          service.verifyEnrollment(enrollment.orderId)
        )
      )
    ).rejects.toMatchObject({ code: "unavailable" });

    expect(state.enrollments[0].state).toBe("pending");
  });

  test("verification without the provider contract stays pending", async () => {
    const state = makeState();
    const enrollment = seedConfirmedEnrollment(state);
    const { run } = makeService(state, undefined, {
      orders: authorizedVerificationOrder(enrollment.orderId),
      contracts: { [providerCustomerId]: [] },
    });

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.verifyEnrollment(enrollment.orderId)
      )
    );

    expect(outcome).toBe("pending");
    expect(state.contracts).toHaveLength(0);
    expect(state.enrollments[0].state).toBe("pending");
  });

  test("cancelEnrollment cancels a still-pending enrollment", async () => {
    const state = makeState();
    const enrollment = seedConfirmedEnrollment(state);
    const { run } = makeService(state);

    const outcome = await run(
      Effect.flatMap(SavedCardService, (service) =>
        service.cancelEnrollment(enrollment.orderId)
      )
    );

    expect(outcome).toBe("cancelled");
    expect(state.enrollments[0].failureCode).toBe("enrollment.cancelled");
  });

  test("listCards shows only the provider ∩ local intersection and drops stale rows", async () => {
    const state = makeState();
    seedConfirmedEnrollment(state); // stale: provider will not list it
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
          {
            contractId: contractId("zzz"),
            circuit: "MC",
            maskedInstrumentSuffix: "1111",
          },
          { contractId: contractId("aaa") },
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

  test("listCards fails closed on a retryable provider failure", async () => {
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

  test("one account cannot list or remove another account's card", async () => {
    const state = makeState();
    seedConfirmedEnrollment(state, {
      customerAccountId: otherAccountId,
      providerContractId: contractId("ofa"),
    });
    state.contracts.push({
      customerAccountId: otherAccountId,
      providerCustomerId,
      providerContractId: contractId("ofa"),
      state: "active",
      displayCircuit: "VISA",
      displaySuffix: "4242",
    });

    const { run, calls } = makeService(state, undefined, {
      contracts: {
        [otherProviderCustomerId]: [
          { contractId: contractId("ofa"), circuit: "VISA" },
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

  test("removeCard treats a provider-missing contract as already removed", async () => {
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

  test("removeCard tolerates a deactivation 404 and marks the row removed", async () => {
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
        [providerCustomerId]: [{ contractId: contractId("nf") }],
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
        [providerCustomerId]: [{ contractId: contractId("stuck") }],
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

  test("deactivateAllForDeletion blocks on retryable failure and resumes afterwards", async () => {
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

  test("deactivateAllForDeletion confirms success only when the provider list is empty", async () => {
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
        [providerCustomerId]: [{ contractId: contractId("del9") }],
      },
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
});
