import "@/shared/polyfills/temporal";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { and, eq } from "drizzle-orm";
import { Effect, Exit, Layer, Option, Schema } from "effect";
import { Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { type DatabaseClient, makeDatabaseClient } from "@/db/database-client";
import {
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  goodsCartItems,
  goodsCarts,
  legalEvidenceEvents,
  orderLines,
  orders,
  promotionCodes,
} from "@/db/schema";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { calculateGoodsBasketDiscounts } from "@/features/discounts/basket-calculator";
import { makeGoodsBasketDiscountCommitment } from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  canonicalPromotionCodeSchema,
  discountCodeIdSchema,
  promotionCodeIdSchema,
  storedDiscountIdSchema,
} from "@/features/discounts/persistence-contracts";
import {
  type GoodsOrderIssuanceFacts,
  goodsCartIdSchema,
  goodsOrderIssuanceFactsSchema,
  workspaceGoodsProductIdentitySchema,
} from "@/features/goods";
import {
  GoodsOrderRepository,
  type IGoodsOrderRepository,
} from "./goods-order.repository";
import { getGoodsOrderIssuanceFingerprint } from "./goods-order-issuance-fingerprint";

const databaseTestsEnabled =
  process.env.WORKSPACE_ORDER_DATABASE_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL);
const pool = databaseTestsEnabled
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 4 })
  : undefined;
let database: DatabaseClient;
let repository: IGoodsOrderRepository;

const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const makeFixture = async (withDiscount: boolean) => {
  const suffix = crypto.randomUUID();
  const customerId = DotyposCustomerIdSchema.make(`goods-issue-test-${suffix}`);
  const categoryId = DotyposCategoryIdSchema.make(`category-${suffix}`);
  const productId = DotyposProductIdSchema.make(`product-${suffix}`);
  const product = workspaceGoodsProductIdentitySchema.make({
    kind: "goods",
    categoryId,
    productId,
  });
  const cartId = goodsCartIdSchema.make(`cart-${suffix}`);
  const issuedAt = Temporal.Instant.from("2026-08-16T20:30:00.000Z");
  const calculation = await Effect.runPromise(
    calculateGoodsBasketDiscounts({
      lines: [{ product, discountableSubtotal: money(9000) }],
      candidates: withDiscount
        ? [
            {
              eligibleLineIndexes: [0],
              candidate: {
                discount: {
                  id: discountIdSchema.make(suffix),
                  label: "Synthetic issued-goods discount",
                  adjustment: { kind: "fixed", amount: money(1000) },
                },
                provenance: {
                  providerNamespace: "database-discount-code",
                  providerReference: `code-${suffix}`,
                },
                claim: {
                  kind: "discount_code",
                  codeId: discountCodeIdSchema.make(`code-${suffix}`),
                  storedDiscountId: storedDiscountIdSchema.make(suffix),
                  dotyposCustomerId: customerId,
                  product,
                },
              },
            },
          ]
        : [],
    })
  );
  const facts = Schema.decodeUnknownSync(goodsOrderIssuanceFactsSchema)({
    issuanceId: crypto.randomUUID(),
    expectedCart: {
      revision: 3,
      items: [{ productId, quantity: 2 }],
    },
    lines: [
      {
        product,
        description: "Synthetic sparkling water",
        quantity: 2,
        unitPrice: money(4500),
        undiscountedTotal: money(9000),
        payableTotal: calculation.quote.lines[0]!.discountedSubtotal,
      },
    ],
    locale: "en-US",
    legalDocuments: [
      {
        documentKey: "termsAndConditions",
        document: {
          path: "/en-US/terms-and-conditions",
          hash: "a".repeat(64),
          hashAlgorithm: "sha256",
        },
      },
      {
        documentKey: "operatingRules",
        document: {
          path: "/en-US/operating-rules",
          hash: "b".repeat(64),
          hashAlgorithm: "sha256",
        },
      },
    ],
  });
  return {
    cartId,
    customerId,
    facts,
    issuedAt,
    commitment: makeGoodsBasketDiscountCommitment(calculation),
    discount: withDiscount
      ? {
          code: canonicalPromotionCodeSchema.make(
            `T${suffix.replaceAll("-", "").toUpperCase()}`
          ),
          codeId: discountCodeIdSchema.make(`code-${suffix}`),
          discountId: storedDiscountIdSchema.make(suffix),
          promotionId: promotionCodeIdSchema.make(`promotion-${suffix}`),
        }
      : undefined,
  };
};

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

const seedFixture = (fixture: Fixture) =>
  database.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.insert(goodsCarts).values({
        id: fixture.cartId,
        dotyposCustomerId: fixture.customerId,
        revision: fixture.facts.expectedCart.revision,
      });
      yield* tx.insert(goodsCartItems).values({
        cartId: fixture.cartId,
        productId: fixture.facts.expectedCart.items[0]!.productId,
        quantity: fixture.facts.expectedCart.items[0]!.quantity,
      });
      if (!fixture.discount) return;
      yield* tx.insert(discounts).values({
        id: fixture.discount.discountId,
        labels: {
          "en-US": "Synthetic issued-goods discount",
          "cs-CZ": "Synthetic issued-goods discount",
        },
        fixedAmountValue: 1000,
        fixedAmountExponent: 2,
        fixedAmountCurrency: "CZK",
      });
      yield* tx.insert(discountProductTargets).values({
        discountId: fixture.discount.discountId,
        productTarget: { kind: "goods" },
      });
      yield* tx.insert(promotionCodes).values({
        id: fixture.discount.promotionId,
        kind: "discount",
        code: fixture.discount.code,
        enabled: true,
      });
      yield* tx.insert(discountCodes).values({
        id: fixture.discount.codeId,
        code: fixture.discount.code,
        enabled: true,
        promotionCodeId: fixture.discount.promotionId,
        discountId: fixture.discount.discountId,
      });
    })
  );

const issue = (
  fixture: Fixture,
  facts: GoodsOrderIssuanceFacts = fixture.facts
) =>
  repository.issue({
    ...facts,
    customerId: fixture.customerId,
    issuedAt: fixture.issuedAt,
    issuanceFingerprint: fingerprintFor(facts),
    discountCommitment: fixture.commitment,
  });

const fingerprintFor = (facts: GoodsOrderIssuanceFacts) =>
  getGoodsOrderIssuanceFingerprint({
    acknowledged: true,
    quoteToken: JSON.stringify(facts),
  });

describe.skipIf(!databaseTestsEnabled)("goods order issuance database", () => {
  beforeAll(async () => {
    database = await Effect.runPromise(makeDatabaseClient(pool!));
    repository = await Effect.runPromise(
      GoodsOrderRepository.pipe(
        Effect.provide(
          GoodsOrderRepository.Default.pipe(
            Layer.provide(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database })
              )
            )
          )
        )
      )
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  test("replays one immutable issuance with one timestamp and one redeemed claim", async () => {
    const fixture = await makeFixture(true);
    await Effect.runPromise(seedFixture(fixture));

    const first = await Effect.runPromise(issue(fixture));
    const replay = await Effect.runPromise(issue(fixture));
    const found = await Effect.runPromise(
      repository.findByIssuanceId(
        fixture.customerId,
        fixture.facts.issuanceId,
        fingerprintFor(fixture.facts)
      )
    );

    expect(replay).toEqual(first);
    expect(Option.getOrUndefined(found)).toEqual(first);
    const [order] = await Effect.runPromise(
      database.select().from(orders).where(eq(orders.id, first.id))
    );
    const lines = await Effect.runPromise(
      database.select().from(orderLines).where(eq(orderLines.orderId, first.id))
    );
    const evidence = await Effect.runPromise(
      database
        .select()
        .from(legalEvidenceEvents)
        .where(eq(legalEvidenceEvents.orderId, first.id))
    );
    const applications = await Effect.runPromise(
      database
        .select()
        .from(discountApplications)
        .where(eq(discountApplications.orderId, first.id))
    );
    const claims = await Effect.runPromise(
      database
        .select()
        .from(discountCodeRedemptions)
        .where(eq(discountCodeRedemptions.orderId, first.id))
    );
    const [cart] = await Effect.runPromise(
      database
        .select()
        .from(goodsCarts)
        .where(eq(goodsCarts.id, fixture.cartId))
    );
    const cartItems = await Effect.runPromise(
      database
        .select()
        .from(goodsCartItems)
        .where(eq(goodsCartItems.cartId, fixture.cartId))
    );

    expect(order).toMatchObject({
      fulfillmentState: "fulfilled",
      paymentState: "not_started",
    });
    for (const timestamp of [
      order?.createdAt,
      order?.updatedAt,
      order?.fulfilledAt,
      lines[0]?.createdAt,
      evidence[0]?.acceptedAt,
      claims[0]?.redeemedAt,
    ]) {
      expect(Temporal.Instant.compare(timestamp!, fixture.issuedAt)).toBe(0);
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: "Synthetic sparkling water",
      quantity: 2,
      unitPriceValue: 4500,
      undiscountedTotalValue: 9000,
      payableTotalValue: 8000,
    });
    expect(evidence.map(({ documentKey }) => documentKey).sort()).toEqual([
      "operatingRules",
      "termsAndConditions",
    ]);
    expect(evidence.every(({ accepted }) => accepted)).toBe(true);
    expect(applications).toHaveLength(1);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      state: "redeemed",
      appliedAmountValue: 1000,
    });
    expect(cart?.revision).toBe(4);
    expect(cartItems).toEqual([]);

    expect(
      Exit.isFailure(
        await Effect.runPromise(
          Effect.result(
            database
              .update(orderLines)
              .set({ description: "mutated" })
              .where(eq(orderLines.orderId, first.id))
          )
        )
      )
    ).toBe(true);
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          Effect.result(
            database.delete(orderLines).where(eq(orderLines.orderId, first.id))
          )
        )
      )
    ).toBe(true);
  });

  test("serializes two issuance identifiers against one cart", async () => {
    const fixture = await makeFixture(false);
    await Effect.runPromise(seedFixture(fixture));
    const otherFacts = {
      ...fixture.facts,
      issuanceId: Schema.decodeUnknownSync(
        goodsOrderIssuanceFactsSchema.fields.issuanceId
      )(crypto.randomUUID()),
    };

    const results = await Effect.runPromise(
      Effect.all(
        [issue(fixture), issue(fixture, otherFacts)].map(Effect.result),
        { concurrency: "unbounded" }
      )
    );

    expect(results.filter(Exit.isSuccess)).toHaveLength(1);
    expect(results.filter(Exit.isFailure)).toHaveLength(1);
    const persisted = await Effect.runPromise(
      database
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.kind, "goods"),
            eq(orders.dotyposCustomerId, fixture.customerId)
          )
        )
    );
    const [cart] = await Effect.runPromise(
      database
        .select()
        .from(goodsCarts)
        .where(eq(goodsCarts.id, fixture.cartId))
    );
    const persistedCorrelationIds = persisted.map(({ correlationId }) =>
      String(correlationId)
    );
    expect(persistedCorrelationIds).toHaveLength(1);
    expect(
      [fixture.facts.issuanceId, otherFacts.issuanceId].map(String)
    ).toContain(persistedCorrelationIds[0]);
    expect(cart?.revision).toBe(4);
  });
});
