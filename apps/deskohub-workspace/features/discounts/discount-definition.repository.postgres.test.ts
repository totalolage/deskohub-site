import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { discountProductTargets, discounts } from "@/db/schema";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { DiscountDefinitionMalformedError } from "./discount-definition";
import {
  DiscountDefinitionNotFoundError,
  DiscountDefinitionRepository,
} from "./discount-definition.repository";
import {
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "./persistence-contracts";
import type { WorkspaceProductTarget } from "./product-target";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "DiscountDefinitionRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const discountIds: StoredDiscountId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from discounts where id = any($1)",
        [discountIds]
      );
    });

    const loadById = (discountId: StoredDiscountId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const repository = yield* DiscountDefinitionRepository;
          return yield* repository.loadById({ discountId });
        }).pipe(
          Effect.provide(DiscountDefinitionRepository.Default),
          Effect.provide(testDatabase.layer),
          Effect.result
        )
      );

    /** Inserts a synthetic discount definition with the given product targets. */
    const insertDiscount = async (input: {
      readonly adjustment:
        | { readonly percentageBasisPoints: number }
        | {
            readonly fixedAmountValue: number;
            readonly fixedAmountExponent: number;
            readonly fixedAmountCurrency: string;
          };
      readonly products: readonly WorkspaceProductTarget[];
    }) => {
      const id = storedDiscountIdSchema.make(crypto.randomUUID());
      discountIds.push(id);
      await Effect.runPromise(
        testDatabase.db.insert(discounts).values({
          id,
          labels: { "cs-CZ": "Testovací sleva", "en-US": "Test discount" },
          ...input.adjustment,
        })
      );
      if (input.products.length > 0) {
        await Effect.runPromise(
          testDatabase.db.insert(discountProductTargets).values(
            input.products.map((productTarget) => ({
              discountId: id,
              productTarget,
            }))
          )
        );
      }
      return id;
    };

    test("loads a stored definition with each of its own product targets", async () => {
      const percentageDiscountId = await insertDiscount({
        adjustment: { percentageBasisPoints: 1500 },
        products: [{ kind: "cowork" }, { kind: "office" }],
      });
      const fixedDiscountId = await insertDiscount({
        adjustment: {
          fixedAmountValue: 5000,
          fixedAmountExponent: 2,
          fixedAmountCurrency: "CZK",
        },
        products: [{ kind: "meeting-room" }],
      });

      const percentageDiscount = await loadById(percentageDiscountId);
      const fixedDiscount = await loadById(fixedDiscountId);

      expect(percentageDiscount._tag).toBe("Success");
      if (percentageDiscount._tag !== "Success") return;
      expect({
        ...percentageDiscount.success,
        products: percentageDiscount.success.products.toSorted((left, right) =>
          left.kind.localeCompare(right.kind)
        ),
      }).toMatchObject({
        id: percentageDiscountId,
        labels: { "cs-CZ": "Testovací sleva", "en-US": "Test discount" },
        adjustment: { kind: "percentage", basisPoints: 1500 },
        products: [{ kind: "cowork" }, { kind: "office" }],
      });
      expect(fixedDiscount).toMatchObject({
        _tag: "Success",
        success: {
          id: fixedDiscountId,
          adjustment: {
            kind: "fixed",
            amount: { value: 5000, exponent: 2, currency: "CZK" },
          },
          products: [{ kind: "meeting-room" }],
        },
      });
    });

    test("stores cowork tier targets exactly, without widening them to every tier", async () => {
      const discountId = await insertDiscount({
        adjustment: { percentageBasisPoints: 1000 },
        products: [
          { kind: "cowork", tier: "open-space" },
          { kind: "cowork", tier: "reserved-desk" },
        ],
      });
      await Effect.runPromise(
        testDatabase.db.delete(discountProductTargets).where(
          and(
            eq(discountProductTargets.discountId, discountId),
            eq(discountProductTargets.productTarget, {
              kind: "cowork",
              tier: "reserved-desk",
            })
          )
        )
      );

      const result = await loadById(discountId);

      expect(result).toMatchObject({
        _tag: "Success",
        success: { products: [{ kind: "cowork", tier: "open-space" }] },
      });
    });

    test("rejects a stored definition without product targets as malformed", async () => {
      const discountId = await insertDiscount({
        adjustment: { percentageBasisPoints: 1000 },
        products: [],
      });

      const result = await loadById(discountId);

      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") return;
      expect(result.failure).toBeInstanceOf(DiscountDefinitionMalformedError);
      expect(result.failure).toMatchObject({ discountId });
    });

    test("fails with a typed not-found error when no stored row matches", async () => {
      const discountId = storedDiscountIdSchema.make(crypto.randomUUID());

      const result = await loadById(discountId);

      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") return;
      expect(result.failure).toBeInstanceOf(DiscountDefinitionNotFoundError);
      expect(result.failure).toMatchObject({ discountId });
    });
  }
);
