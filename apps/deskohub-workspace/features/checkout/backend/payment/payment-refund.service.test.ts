import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type GetNexiOrderInput,
  NexiCorrelationIdSchema,
  NexiOperationIdSchema,
  type NexiOrder,
  NexiOrderIdSchema,
  type NexiService as NexiServiceTag,
} from "@deskohub/nexi";
import { Clock, Context, Duration, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { NexiPaymentAttempt } from "../repositories/payment-attempt.repository";
import type {
  IPaymentRefundRepository,
  RefundablePaymentAttempt,
} from "../repositories/payment-refund.repository";

const providerOrderId = NexiOrderIdSchema.make("provider-order-id");

const attempt: NexiPaymentAttempt = {
  id: paymentAttemptIdSchema.make("attempt-id"),
  workspaceReservationId: workspaceReservationIdSchema.make("reservation-id"),
  provider: "nexi",
  providerOrderId,
  state: "paid",
  refundState: "required",
  refundedAmountValue: null,
  refundedAt: null,
  amount: { value: 35_000, exponent: 2, currency: "CZK" },
  securityToken: "security-token",
  providerRedirectUrl: "https://provider.example/pay",
  providerOrderCreatedAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
  updatedAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
};

const candidate: RefundablePaymentAttempt = {
  attempt,
  correlationId: NexiCorrelationIdSchema.make("correlation-id"),
};

const refundedOrder: NexiOrder = {
  orderId: providerOrderId,
  operations: [
    {
      operationType: "CAPTURE",
      operationResult: "EXECUTED",
      amount: "35000",
    },
    {
      operationId: NexiOperationIdSchema.make("refund-operation-id"),
      operationType: "REFUND",
      // Back-office refunds before settlement are reported as VOIDED.
      operationResult: "VOIDED",
      operationTime: "2026-10-05T08:30:00Z",
      amount: "35000",
    },
  ],
};

const unusedRepositoryCall = () => Effect.die("unused");

const buildService = async (services: {
  readonly getOrder: (typeof NexiServiceTag.Service)["getOrder"];
  readonly recordRefund?: IPaymentRefundRepository["recordRefund"];
  readonly claimRefundChecks?: IPaymentRefundRepository["claimRefundChecks"];
}) => {
  const { NexiService } = await import("@deskohub/nexi");
  const { PaymentRefundRepository } = await import(
    "../repositories/payment-refund.repository"
  );
  const { PaymentRefundService } = await import("./payment-refund.service");

  const layer = PaymentRefundService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(NexiService, { getOrder: services.getOrder }),
        Layer.mock(PaymentRefundRepository, {
          recordRefund: services.recordRefund ?? unusedRepositoryCall,
          claimRefundChecks: services.claimRefundChecks ?? unusedRepositoryCall,
        })
      )
    )
  );

  return <A, E>(
    use: (service: typeof PaymentRefundService.Service) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* PaymentRefundService);
      }).pipe(Effect.provide(layer))
    );
};

describe("PaymentRefundService", () => {
  test("records the refund total and time Nexi reports for the order", async () => {
    const getOrder = mock(() => Effect.succeed(refundedOrder));
    const recordRefund = mock(() => Effect.succeed("recorded" as const));
    const run = await buildService({ getOrder, recordRefund });

    const result = await run((service) => service.reconcileAttempt(candidate));

    expect(result).toBe("recorded");
    expect(getOrder).toHaveBeenCalledWith({
      orderId: "provider-order-id",
      correlationId: "correlation-id",
    });
    expect(recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-id",
        refundedAmountValue: 35_000,
        refundedAt: Temporal.Instant.from("2026-10-05T08:30:00Z"),
      })
    );
  });

  for (const [label, operationTime] of [
    ["omits", undefined],
    // Date.parse accepts an offset-less time, so Nexi summarizes it, but it
    // names no instant.
    ["sends an offset-less", "2026-10-05T08:30:00"],
  ] as const) {
    test(`records the refund at the recording time when Nexi ${label} refund time`, async () => {
      const recordRefund = mock<IPaymentRefundRepository["recordRefund"]>(() =>
        Effect.succeed("recorded" as const)
      );
      const run = await buildService({
        getOrder: () =>
          Effect.succeed({
            ...refundedOrder,
            operations: [
              {
                operationType: "REFUND",
                operationResult: "VOIDED",
                ...(operationTime !== undefined && { operationTime }),
                amount: "35000",
              },
            ],
          }),
        recordRefund,
      });

      const result = await run((service) =>
        service.reconcileAttempt(candidate)
      );

      expect(result).toBe("recorded");
      const [recorded] = recordRefund.mock.calls[0] ?? [];
      expect(recorded?.refundedAmountValue).toBe(35_000);
      expect(recorded?.refundedAt).toEqual(recorded?.recordedAt);
    });
  }

  test("leaves the attempt untouched while Nexi shows no successful refund", async () => {
    const recordRefund = mock(() => Effect.die("not used"));
    const run = await buildService({
      getOrder: () =>
        Effect.succeed({
          ...refundedOrder,
          operations: [
            {
              operationType: "REFUND",
              operationResult: "PENDING",
              amount: "35000",
            },
          ],
        }),
      recordRefund,
    });

    const result = await run((service) => service.reconcileAttempt(candidate));

    expect(result).toBe("no_refund");
    expect(recordRefund).not.toHaveBeenCalled();
  });

  test("keeps reconciling the batch when one provider lookup fails", async () => {
    const recordRefund = mock(() => Effect.succeed("recorded" as const));
    const queue = [
      candidate,
      {
        ...candidate,
        attempt: {
          ...attempt,
          id: paymentAttemptIdSchema.make("failing-attempt-id"),
          providerOrderId: NexiOrderIdSchema.make("failing-order-id"),
        },
      },
    ];
    const claimRefundChecks = mock(
      (input: Parameters<IPaymentRefundRepository["claimRefundChecks"]>[0]) =>
        Effect.sync(() =>
          queue.splice(0, input.limit).map((claimed) => ({
            ...claimed,
            checkedAt: input.checkedAt,
            previousCheckedAt: null,
          }))
        )
    );
    const run = await buildService({
      claimRefundChecks,
      getOrder: (input: GetNexiOrderInput) =>
        input.orderId === "failing-order-id"
          ? Effect.fail(new Error("provider unavailable"))
          : Effect.succeed(refundedOrder),
      recordRefund,
    });

    const summary = await run((service) =>
      service.reconcileRefunds({
        limit: 25,
        budget: "240 seconds",
        worstCaseLookupDuration: "21 seconds",
      })
    );

    expect(summary).toEqual({ checked: 2, recorded: 1, failed: 1 });
    expect(recordRefund).toHaveBeenCalledTimes(1);
    // Each lookup claims its own attempt; the batch stops once none is left.
    expect(
      claimRefundChecks.mock.calls.every(([claim]) => claim.limit === 1)
    ).toBe(true);
    expect(claimRefundChecks).toHaveBeenCalledWith({
      limit: 1,
      checkedAt: expect.any(Temporal.Instant),
      lastCheckedBefore: expect.any(Temporal.Instant),
      recentPaymentsSince: expect.any(Temporal.Instant),
    });
    const claim = claimRefundChecks.mock.calls[0]?.[0];
    expect(
      claim?.checkedAt.since(claim.recentPaymentsSince).total("hours")
    ).toBe(30 * 24);
    expect(claim?.checkedAt.since(claim.lastCheckedBefore).total("hours")).toBe(
      6
    );
  });

  test("finishes within its budget when every Nexi lookup times out through the retry layer", async () => {
    const { getNexiRequestWorstCaseDuration, NexiRuntimeConfig, NexiService } =
      await import("@deskohub/nexi");
    const { PaymentRefundRepository } = await import(
      "../repositories/payment-refund.repository"
    );
    const { PaymentRefundService } = await import("./payment-refund.service");

    let fetches = 0;
    const unansweredFetch = ((
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      fetches += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true }
        );
      });
    }) as typeof globalThis.fetch;
    const claimed: string[] = [];
    const claimRefundChecks: IPaymentRefundRepository["claimRefundChecks"] = (
      input
    ) =>
      Effect.sync(() =>
        Array.from({ length: input.limit }, () => {
          const id = paymentAttemptIdSchema.make(`attempt-${claimed.length}`);
          claimed.push(id);
          return {
            ...candidate,
            attempt: { ...attempt, id },
            checkedAt: input.checkedAt,
            previousCheckedAt: null,
          };
        })
      );
    const apiTimeout = 5000;
    const budget = Duration.seconds(240);
    const layer = PaymentRefundService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          NexiService.Live.pipe(
            Layer.provide(
              Layer.succeed(NexiRuntimeConfig, {
                baseUrl: "https://nexi.example.test",
                apiKey: "synthetic-api-key",
                apiTimeout,
              })
            )
          ),
          Layer.mock(PaymentRefundRepository, {
            claimRefundChecks,
            recordRefund: unusedRepositoryCall,
          })
        )
      )
    );

    const { elapsedMilliseconds, summary } = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* PaymentRefundService;
        const batch = yield* Effect.forkChild(
          service.reconcileRefunds({
            limit: 150,
            budget,
            worstCaseLookupDuration:
              getNexiRequestWorstCaseDuration(apiTimeout),
          })
        );
        let elapsedMilliseconds = 0;
        while (batch.pollUnsafe() === undefined) {
          yield* TestClock.adjust("100 millis");
          elapsedMilliseconds += 100;
        }
        return { elapsedMilliseconds, summary: yield* Fiber.join(batch) };
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(FetchHttpClient.Fetch, unansweredFetch),
        Effect.provide(TestClock.layer())
      )
    );

    expect(elapsedMilliseconds).toBeLessThanOrEqual(Duration.toMillis(budget));
    // Each of the four workers fits 11 lookups of about 21 seconds.
    expect(summary.checked).toBe(44);
    expect(summary.failed).toBe(summary.checked);
    // Only attempts the batch actually looked up were claimed and stamped.
    expect(claimed).toHaveLength(summary.checked);
    expect(fetches).toBe(summary.checked * 4);
  });

  describe("with slow database calls", () => {
    const budget = Duration.seconds(240);
    const lookupMilliseconds = 20_840;

    /**
     * Runs a batch on a TestClock against a Nexi stub that answers after
     * `lookupMilliseconds` and a repository whose calls take as long as the
     * given delays, recording what the batch committed, looked up, and
     * released.
     */
    const runSlowBatch = async (delays: {
      readonly claim?: (index: number) => Duration.Input;
      readonly record?: (index: number) => Duration.Input;
      readonly release?: Duration.Input;
    }) => {
      const { NexiService } = await import("@deskohub/nexi");
      const { PaymentRefundRepository } = await import(
        "../repositories/payment-refund.repository"
      );
      const { PaymentRefundService } = await import("./payment-refund.service");
      const committed: string[] = [];
      const lookupStarts: number[] = [];
      const released: string[] = [];
      let claims = 0;
      const indexOf = (id: string) => Number(id.replace("attempt-", ""));

      const layer = PaymentRefundService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(NexiService, {
              getOrder: () =>
                Effect.gen(function* () {
                  lookupStarts.push(yield* Clock.currentTimeMillis);
                  yield* Effect.sleep(Duration.millis(lookupMilliseconds));
                  return refundedOrder;
                }),
            }),
            Layer.mock(PaymentRefundRepository, {
              claimRefundChecks: (input) =>
                Effect.gen(function* () {
                  const index = claims;
                  claims += 1;
                  yield* Effect.sleep(delays.claim?.(index) ?? 0);
                  const id = paymentAttemptIdSchema.make(`attempt-${index}`);
                  committed.push(id);
                  return [
                    {
                      ...candidate,
                      attempt: { ...attempt, id },
                      checkedAt: input.checkedAt,
                      previousCheckedAt: null,
                    },
                  ];
                }),
              recordRefund: (input) =>
                Effect.gen(function* () {
                  yield* Effect.sleep(delays.record?.(indexOf(input.id)) ?? 0);
                  return "recorded" as const;
                }),
              releaseRefundCheck: (input) =>
                Effect.gen(function* () {
                  yield* Effect.sleep(delays.release ?? 0);
                  released.push(input.id);
                }),
            })
          )
        )
      );

      const { elapsedMilliseconds, summary } = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PaymentRefundService;
          const batch = yield* Effect.forkChild(
            service.reconcileRefunds({
              limit: 150,
              budget,
              worstCaseLookupDuration: Duration.millis(lookupMilliseconds),
            })
          );
          let elapsedMilliseconds = 0;
          while (batch.pollUnsafe() === undefined) {
            yield* TestClock.adjust("100 millis");
            elapsedMilliseconds += 100;
          }
          return { elapsedMilliseconds, summary: yield* Fiber.join(batch) };
        }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer()))
      );
      return {
        committed,
        elapsedMilliseconds,
        lookupStarts,
        released,
        summary,
      };
    };

    test("releases a claim that leaves too little time for its lookup", async () => {
      const result = await runSlowBatch({
        claim: (index) => (index >= 40 ? "12 seconds" : 0),
      });

      expect(result.elapsedMilliseconds).toBeLessThanOrEqual(
        Duration.toMillis(budget)
      );
      for (const start of result.lookupStarts) {
        expect(start).toBeLessThanOrEqual(
          Duration.toMillis(budget) - lookupMilliseconds
        );
      }
      expect(result.released.length).toBeGreaterThan(0);
      // Every attempt the batch stamped was either checked or released.
      expect(result.committed).toHaveLength(
        result.summary.checked + result.released.length
      );
    });

    test("stops a claim that runs into the budget without stamping its attempt", async () => {
      const result = await runSlowBatch({
        claim: (index) => (index >= 40 ? "75 seconds" : 0),
      });

      expect(result.elapsedMilliseconds).toBeLessThanOrEqual(
        Duration.toMillis(budget)
      );
      expect(result.committed).toHaveLength(result.summary.checked);
      expect(result.released).toEqual([]);
    });

    test("releases attempts whose refund recording runs past the budget", async () => {
      const result = await runSlowBatch({
        record: (index) => (index >= 36 ? "60 seconds" : 0),
      });

      expect(result.elapsedMilliseconds).toBeLessThanOrEqual(
        Duration.toMillis(budget)
      );
      expect(result.released.length).toBeGreaterThan(0);
      expect(result.committed).toHaveLength(
        result.summary.checked + result.released.length
      );
      expect(result.summary.recorded).toBe(result.summary.checked);
    });

    test("gives up on a release that hangs after a bounded wait", async () => {
      const result = await runSlowBatch({
        record: (index) => (index >= 36 ? "60 seconds" : 0),
        release: "1 hour",
      });

      expect(result.elapsedMilliseconds).toBeLessThanOrEqual(
        Duration.toMillis(budget) + 10_000
      );
      expect(result.released).toEqual([]);
    });
  });

  describe("with uninterruptible transaction phases", () => {
    const budget = Duration.seconds(240);
    const lookupMilliseconds = 20_840;

    /**
     * Runs a batch whose claims after the first 40 go through Effect SQL's
     * real transaction wrapper, which acquires its connection, runs BEGIN,
     * and commits or rolls back uninterruptibly, each phase taking as long as
     * given.
     */
    const runTransactionalBatch = async (phases: {
      readonly acquire: Duration.Input;
      readonly begin: Duration.Input;
      readonly commit: Duration.Input;
      readonly rollback: Duration.Input;
      readonly release: Duration.Input;
      /** Delay inside the transaction, where Effect SQL can interrupt it. */
      readonly statements?: Duration.Input;
    }) => {
      const { NexiService } = await import("@deskohub/nexi");
      const { makeWithTransaction } = await import(
        "effect/unstable/sql/SqlClient"
      );
      const { PaymentRefundRepository } = await import(
        "../repositories/payment-refund.repository"
      );
      const { PaymentRefundService, refundBatchOverrunWorstCase } =
        await import("./payment-refund.service");
      const withTransaction = makeWithTransaction({
        transactionService: Context.Service<never, readonly [object, number]>(
          "@test/RefundClaimTransaction"
        ),
        spanAttributes: [],
        acquireConnection: Effect.sleep(phases.acquire).pipe(
          Effect.as([undefined, {}] as const)
        ),
        begin: () => Effect.sleep(phases.begin),
        commit: () => Effect.sleep(phases.commit),
        rollback: () => Effect.sleep(phases.rollback),
        savepoint: () => Effect.void,
        rollbackSavepoint: () => Effect.void,
      });
      let claims = 0;

      const layer = PaymentRefundService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(NexiService, {
              getOrder: () =>
                Effect.sleep(Duration.millis(lookupMilliseconds)).pipe(
                  Effect.as({ ...refundedOrder, operations: [] })
                ),
            }),
            Layer.mock(PaymentRefundRepository, {
              claimRefundChecks: (input) => {
                const index = claims;
                claims += 1;
                const claimed = [
                  {
                    ...candidate,
                    attempt: {
                      ...attempt,
                      id: paymentAttemptIdSchema.make(`attempt-${index}`),
                    },
                    checkedAt: input.checkedAt,
                    previousCheckedAt: null,
                  },
                ];
                // Delaying the first claims makes the last ones start at
                // 218.9 s, just before the 219.16 s lookup cutoff.
                if (index < 4) {
                  return Effect.sleep("10500 millis").pipe(Effect.as(claimed));
                }
                return index < 40
                  ? Effect.succeed(claimed)
                  : withTransaction(
                      Effect.sleep(phases.statements ?? 0).pipe(
                        Effect.as(claimed)
                      )
                    ).pipe(Effect.orDie);
              },
              releaseRefundCheck: () => Effect.sleep(phases.release),
            })
          )
        )
      );

      const elapsedMilliseconds = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PaymentRefundService;
          const batch = yield* Effect.forkChild(
            service.reconcileRefunds({
              limit: 150,
              budget,
              worstCaseLookupDuration: Duration.millis(lookupMilliseconds),
            })
          );
          let elapsedMilliseconds = 0;
          while (batch.pollUnsafe() === undefined) {
            yield* TestClock.adjust("100 millis");
            elapsedMilliseconds += 100;
          }
          yield* Fiber.join(batch);
          return elapsedMilliseconds;
        }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer()))
      );
      return {
        bound:
          Duration.toMillis(budget) +
          Duration.toMillis(refundBatchOverrunWorstCase),
        elapsedMilliseconds,
      };
    };

    test("stays within the documented bound when the deadline interrupts a claim before BEGIN finishes", async () => {
      // The reviewer's case: the last claims start just before the cutoff
      // and spend the pool's full timeouts acquiring, beginning, and rolling
      // back after the deadline interrupts them.
      const result = await runTransactionalBatch({
        acquire: "15 seconds",
        begin: "10 seconds",
        commit: "10 seconds",
        rollback: "10 seconds",
        release: 0,
      });

      expect(result.elapsedMilliseconds).toBeGreaterThan(
        Duration.toMillis(budget)
      );
      expect(result.elapsedMilliseconds).toBeLessThanOrEqual(result.bound);
    });

    test("stays within the documented bound when a claim commits at the deadline", async () => {
      // The COMMIT starting at 233.9 s runs past the deadline uninterruptibly.
      const result = await runTransactionalBatch({
        acquire: 0,
        begin: 0,
        statements: "15 seconds",
        commit: "10 seconds",
        rollback: "10 seconds",
        release: "1 hour",
      });

      expect(result.elapsedMilliseconds).toBeGreaterThan(
        Duration.toMillis(budget)
      );
      expect(result.elapsedMilliseconds).toBeLessThanOrEqual(result.bound);
    });
  });
});
