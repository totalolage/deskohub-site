import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import {
  ExternalAPIError,
  NetworkError,
  NexiOperationIdSchema,
  NexiOrderIdSchema,
} from "@deskohub/nexi";
import { NexiServiceMock } from "@deskohub/nexi/backend/service.mock";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  type IPaymentAdministrationService,
  PaymentAdministrationService,
} from "./payment-administration.service";

const makeLocalOrder = (
  providerOrderId: string,
  reservationId: string,
  createdAt: string,
  options?: {
    readonly providerOrderCreatedAt?: string | null;
    readonly providerSessionAttached?: boolean;
  }
) => ({
  paymentAttemptId: `attempt-${providerOrderId}`,
  providerOrderId,
  reservationId,
  state: "pending" as const,
  refundState: "not_required" as const,
  refundedAmountValue: null,
  refundedAt: null,
  amountValue: 5000,
  amountExponent: 2,
  currency: "CZK",
  attemptCreatedAt: Temporal.Instant.from(createdAt),
  providerOrderCreatedAt:
    options?.providerOrderCreatedAt === null
      ? null
      : Temporal.Instant.from(options?.providerOrderCreatedAt ?? createdAt),
  providerSessionAttached: options?.providerSessionAttached ?? true,
  updatedAt: Temporal.Instant.from(createdAt),
});

const makeQuery = <A>(rows: readonly A[]) => {
  const result = Effect.succeed(rows);
  return Object.assign(result, {
    limit: () => result,
    orderBy: () => Object.assign(result, { limit: () => result }),
  });
};

// A database whose every select returns the next of the given row sets.
const makeDatabase = (...selections: readonly (readonly unknown[])[]) => {
  const selected: number[] = [];
  return {
    selected,
    database: {
      select: () => {
        selected.push(selected.length + 1);
        const rows = selections[selected.length - 1] ?? [];
        return { from: () => ({ where: () => makeQuery(rows) }) };
      },
    },
  };
};

const runAdministration = <A>(
  database: { readonly select: () => unknown },
  nexi: Parameters<typeof NexiServiceMock>[0],
  use: (
    administration: IPaymentAdministrationService
  ) => Effect.Effect<A, unknown>
) =>
  Effect.gen(function* () {
    return yield* use(yield* PaymentAdministrationService);
  }).pipe(
    Effect.provide(
      PaymentAdministrationService.Default.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(
              WorkspaceDatabase,
              WorkspaceDatabase.make(database as never)
            ),
            NexiServiceMock(nexi)
          )
        )
      )
    ),
    Effect.runPromise
  );

const orderId = (value: string) => NexiOrderIdSchema.make(value);
const operationId = (value: string) => NexiOperationIdSchema.make(value);

const nexiError = (statusCode: number) =>
  new ExternalAPIError({
    operation: "lookup",
    service: "nexi",
    statusCode,
  });

const networkError = () => new NetworkError({ message: "Nexi timed out" });

describe("PaymentAdministrationService", () => {
  test("links returned provider orders beyond the truncated local page", async () => {
    const newestLocalOrder = makeLocalOrder(
      "newest-local-order",
      "newest-reservation",
      "2026-08-06T11:00:00Z"
    );
    const linkedOlderOrder = makeLocalOrder(
      "provider-order",
      "linked-reservation",
      "2026-08-06T10:00:00Z",
      { providerOrderCreatedAt: null }
    );
    let selectCalls = 0;
    const database = {
      select: () => {
        selectCalls += 1;
        const rows =
          selectCalls === 1 ? [newestLocalOrder] : [linkedOlderOrder];
        return {
          from: () => ({ where: () => makeQuery(rows) }),
        };
      },
    };

    const result = await Effect.gen(function* () {
      const administration = yield* PaymentAdministrationService;
      return yield* administration.listOrders({ maxRecords: 1 });
    }).pipe(
      Effect.provide(
        PaymentAdministrationService.Default.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.make(database as never)
              ),
              NexiServiceMock({
                listOrders: () =>
                  Effect.succeed([
                    {
                      orderId: "provider-order",
                      operations: [],
                    },
                  ]),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(selectCalls).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      orderId: "newest-local-order",
      providerStatus: "not_returned",
      link: { reservationId: "newest-reservation" },
    });
    expect(result.items[1]).toMatchObject({
      orderId: "provider-order",
      providerStatus: "available",
      link: {
        reservationId: "linked-reservation",
        providerOrderCreatedAt: "2026-08-06T10:00:00Z",
        providerOrderCreatedAtEstimated: true,
        refundState: "not_required",
        refundedAmount: null,
        refundedAt: null,
      },
    });
  });

  test("orders the list by latest Nexi activity, then order and attempt creation", async () => {
    const attemptOnly = makeLocalOrder(
      "attempt-only",
      "attempt-reservation",
      "2026-08-06T09:00:00Z",
      { providerOrderCreatedAt: null, providerSessionAttached: false }
    );
    const { database } = makeDatabase([attemptOnly]);

    const result = await runAdministration(
      database,
      {
        listOrders: () =>
          Effect.succeed([
            {
              lastOperationTime: "2026-08-06T12:00:00Z",
              operations: [],
              orderId: orderId("recent-activity"),
            },
            { operations: [], orderId: orderId("no-activity") },
          ]),
      },
      (administration) => administration.listOrders({})
    );

    expect(result.items.map((item) => item.orderId)).toEqual([
      "recent-activity",
      "attempt-only",
      "no-activity",
    ]);
    expect(result.providerAvailable).toBe(true);
  });

  test("loads one order with its local attempt and Nexi details", async () => {
    const local = makeLocalOrder(
      "single-order",
      "single-reservation",
      "2026-08-06T10:00:00Z"
    );
    const { database } = makeDatabase([local]);
    const provider = {
      operations: [],
      orderId: orderId("single-order"),
    };

    const order = await runAdministration(
      database,
      { getOrder: () => Effect.succeed(provider) },
      (administration) => administration.loadOrder(orderId("single-order"))
    );

    expect(order).toMatchObject({
      orderId: "single-order",
      provider,
      providerAvailable: true,
      providerStatus: "available",
      link: { reservationId: "single-reservation" },
    });
  });

  test("tells a missing Nexi order from an unreachable one when loading an order", async () => {
    const statuses = await Promise.all(
      [nexiError(404), nexiError(502), networkError()].map((failure) =>
        runAdministration(
          makeDatabase([]).database,
          { getOrder: () => Effect.fail(failure) },
          (administration) => administration.loadOrder(orderId("lost-order"))
        )
      )
    );

    expect(statuses).toEqual([
      {
        orderId: orderId("lost-order"),
        provider: null,
        providerAvailable: false,
        providerStatus: "not_found",
        link: null,
      },
      {
        orderId: orderId("lost-order"),
        provider: null,
        providerAvailable: false,
        providerStatus: "unavailable",
        link: null,
      },
      {
        orderId: orderId("lost-order"),
        provider: null,
        providerAvailable: false,
        providerStatus: "unavailable",
        link: null,
      },
    ]);
  });

  test("links listed Nexi operations to the reservations that opened their orders", async () => {
    const linked = makeLocalOrder(
      "linked-order",
      "linked-reservation",
      "2026-08-06T10:00:00Z"
    );
    const { database } = makeDatabase([linked]);
    const operations = [
      {
        operationId: operationId("op-linked"),
        orderId: orderId("linked-order"),
      },
      {
        operationId: operationId("op-unlinked"),
        orderId: orderId("foreign-order"),
      },
      { operationId: operationId("op-orderless") },
    ];

    const result = await runAdministration(
      database,
      { listOperations: () => Effect.succeed(operations) },
      (administration) => administration.listOperations({ maxRecords: 3 })
    );

    expect(result).toEqual({
      items: [
        { ...operations[0], linkedReservationId: "linked-reservation" },
        { ...operations[1], linkedReservationId: null },
        { ...operations[2], linkedReservationId: null },
      ],
      providerAvailable: true,
      truncated: true,
    });
  });

  test("lists no operations while Nexi is unreachable", async () => {
    const { database, selected } = makeDatabase();

    const result = await runAdministration(
      database,
      { listOperations: () => Effect.fail(networkError()) },
      (administration) => administration.listOperations({})
    );

    expect(result).toEqual({
      items: [],
      providerAvailable: false,
      truncated: false,
    });
    expect(selected).toEqual([]);
  });

  test("loads one Nexi operation with the reservation that opened its order", async () => {
    const linked = makeLocalOrder(
      "operation-order",
      "operation-reservation",
      "2026-08-06T10:00:00Z"
    );
    const { database } = makeDatabase([linked]);
    const operation = {
      operationId: operationId("op-1"),
      orderId: orderId("operation-order"),
    };

    const result = await runAdministration(
      database,
      { getOperation: () => Effect.succeed(operation) },
      (administration) => administration.loadOperation(operationId("op-1"))
    );

    expect(result).toEqual({
      operationId: operationId("op-1"),
      operation,
      providerAvailable: true,
      providerStatus: "available",
      linkedReservationId: "operation-reservation",
    });
  });

  test("skips the reservation lookup for an operation without a Nexi order", async () => {
    const { database, selected } = makeDatabase();
    const operation = { operationId: operationId("op-orderless") };

    const result = await runAdministration(
      database,
      { getOperation: () => Effect.succeed(operation) },
      (administration) =>
        administration.loadOperation(operationId("op-orderless"))
    );

    expect(result.linkedReservationId).toBeNull();
    expect(result.operation).toEqual(operation);
    expect(selected).toEqual([]);
  });

  test("tells a missing Nexi operation from an unreachable one", async () => {
    const results = await Promise.all(
      [nexiError(404), nexiError(500), networkError()].map((failure) => {
        const { database, selected } = makeDatabase();
        return runAdministration(
          database,
          { getOperation: () => Effect.fail(failure) },
          (administration) =>
            administration.loadOperation(operationId("op-lost"))
        ).then((result) => ({ result, selected }));
      })
    );

    expect(
      results.map(({ result }) => [
        result.providerStatus,
        result.providerAvailable,
        result.operation,
        result.linkedReservationId,
      ])
    ).toEqual([
      ["not_found", false, null, null],
      ["unavailable", false, null, null],
      ["unavailable", false, null, null],
    ]);
    expect(results.every(({ selected }) => selected.length === 0)).toBe(true);
  });

  test("keeps local orders listed while Nexi is unreachable", async () => {
    const local = makeLocalOrder(
      "local-only",
      "local-reservation",
      "2026-08-06T10:00:00Z"
    );
    const { database } = makeDatabase([local]);

    const result = await runAdministration(
      database,
      { listOrders: () => Effect.fail(networkError()) },
      (administration) => administration.listOrders({})
    );

    expect(result).toMatchObject({
      providerAvailable: false,
      truncated: false,
      items: [
        {
          orderId: "local-only",
          provider: null,
          providerAvailable: false,
          providerStatus: "unavailable",
          link: { reservationId: "local-reservation" },
        },
      ],
    });
  });

  test("loads each of a reservation's orders with its own Nexi status", async () => {
    const first = makeLocalOrder(
      "first-order",
      "shared-reservation",
      "2026-08-06T10:00:00Z"
    );
    const second = makeLocalOrder(
      "second-order",
      "shared-reservation",
      "2026-08-06T11:00:00Z"
    );
    const { database } = makeDatabase([first, second]);

    const orders = await runAdministration(
      database,
      {
        getOrder: ({ orderId: requested }) =>
          requested === "first-order"
            ? Effect.succeed({ operations: [], orderId: requested })
            : Effect.fail(nexiError(404)),
      },
      (administration) =>
        administration.loadReservationOrders(
          workspaceReservationIdSchema.make("shared-reservation")
        )
    );

    expect(
      orders.map((order) => [
        order.orderId,
        order.providerStatus,
        order.link?.paymentAttemptId,
      ])
    ).toEqual([
      ["first-order", "available", "attempt-first-order"],
      ["second-order", "not_found", "attempt-second-order"],
    ]);
  });
});
