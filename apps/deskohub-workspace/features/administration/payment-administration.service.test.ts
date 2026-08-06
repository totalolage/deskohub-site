import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { NexiServiceMock } from "@deskohub/nexi/backend/service.mock";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { PaymentAdministrationService } from "./payment-administration.service";

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
  amountValue: 5000,
  amountExponent: 2,
  currency: "CZK",
  attemptCreatedAt: Temporal.Instant.from(createdAt),
  providerOrderCreatedAt:
    options?.providerOrderCreatedAt === null
      ? null
      : Temporal.Instant.from(options?.providerOrderCreatedAt ?? createdAt),
  providerSessionAttached: options?.providerSessionAttached ?? true,
});

const makeQuery = <A>(rows: readonly A[]) => {
  const result = Effect.succeed(rows);
  return Object.assign(result, {
    limit: () => result,
    orderBy: () => Object.assign(result, { limit: () => result }),
  });
};

describe("PaymentAdministrationService", () => {
  test("filters local orders by provider order creation time", async () => {
    let localOrderFilter: SQL | undefined;
    const database = {
      select: () => ({
        from: () => ({
          where: (condition: SQL) => {
            localOrderFilter = condition;
            return makeQuery([]);
          },
        }),
      }),
    };

    await Effect.gen(function* () {
      const administration = yield* PaymentAdministrationService;
      return yield* administration.listOrders({
        fromTime: "2026-08-01T00:00:00Z",
        toTime: "2026-08-06T23:59:59.999999999Z",
      });
    }).pipe(
      Effect.provide(
        PaymentAdministrationService.Live.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              NexiServiceMock({ listOrders: () => Effect.succeed([]) })
            )
          )
        )
      ),
      Effect.runPromise
    );

    const query = new PgDialect().sqlToQuery(localOrderFilter as SQL).sql;
    expect(query).toMatch(
      /coalesce\([^)]*provider_order_created_at[^)]*\) >= \$\d+/
    );
    expect(query).toMatch(
      /coalesce\([^)]*provider_order_created_at[^)]*\) < \$\d+/
    );
  });

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
        PaymentAdministrationService.Live.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
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
      },
    });
  });
});
