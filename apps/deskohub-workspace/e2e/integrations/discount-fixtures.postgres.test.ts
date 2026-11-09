import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { E2EDatabase } from "./database.service";
import {
  discountCodeFixtures,
  discountDefinitionFixtureIds,
  seedDiscountE2EFixtures,
} from "./discount-fixtures";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const codeIds = Object.values(discountCodeFixtures).map(({ id }) => id);
// Vouchers are the fixtures with per-run credit; they have no discount code.
const voucherIds: readonly string[] = Object.values(discountCodeFixtures)
  .filter((fixture) => "creditPerRun" in fixture)
  .map(({ id }) => id);
const discountCodeIds = codeIds.filter((id) => !voucherIds.includes(id));

describe.skipIf(!testDatabase)(
  "seedDiscountE2EFixtures on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { pool } = testDatabase;
    const seed = () =>
      Effect.runPromise(
        seedDiscountE2EFixtures.pipe(
          Effect.provideService(
            E2EDatabase,
            E2EDatabase.of({ db: testDatabase.db })
          )
        )
      );
    const snapshot = async () => {
      const [codes, promotions, customers, targets, issued] = await Promise.all(
        [
          pool.query(
            "select id, code, enabled, discount_id, max_uses, max_uses_per_customer, promotion_code_id, valid_from is not null as has_valid_from, valid_until is not null as has_valid_until from discount_codes where id = any($1) order by code",
            [discountCodeIds]
          ),
          pool.query(
            "select id, kind, code, enabled from promotion_codes where id = any($1) order by code",
            [codeIds]
          ),
          pool.query(
            "select promotion_code_id, dotypos_customer_id from promotion_code_customers where promotion_code_id = any($1)",
            [codeIds]
          ),
          pool.query(
            "select discount_id, product_target from discount_targets where discount_id = any($1) order by discount_id, product_target::text",
            [discountDefinitionFixtureIds]
          ),
          pool.query(
            "select id, issued_amount_value from vouchers where id = any($1) order by id",
            [voucherIds]
          ),
        ]
      );
      return {
        codes: codes.rows,
        customers: customers.rows,
        issued: issued.rows,
        promotions: promotions.rows,
        targets: targets.rows,
      };
    };

    afterAll(async () => {
      // Deleting a discount code also deletes its synced promotion code.
      await pool.query("delete from discount_codes where id = any($1)", [
        discountCodeIds,
      ]);
      await pool.query("delete from promotion_codes where id = any($1)", [
        voucherIds,
      ]);
      await pool.query("delete from discounts where id = any($1)", [
        discountDefinitionFixtureIds,
      ]);
    });

    test("writes every fixture row and restores drift on a rerun", async () => {
      await seed();
      const seeded = await snapshot();

      expect(seeded.codes).toHaveLength(discountCodeIds.length);
      expect(seeded.promotions).toHaveLength(codeIds.length);
      expect(
        seeded.promotions.filter(({ kind }) => kind === "voucher")
      ).toHaveLength(voucherIds.length);
      expect(
        seeded.codes.find(
          ({ id }) => id === discountCodeFixtures.capacityOne.id
        )?.max_uses
      ).toBe(1);
      expect(seeded.customers).toEqual([
        {
          dotypos_customer_id: "workspace-e2e-other-customer",
          promotion_code_id: discountCodeFixtures.customerIneligible.id,
        },
      ]);
      expect(seeded.issued).toEqual(
        voucherIds.toSorted().map((id) => ({
          id,
          issued_amount_value: Object.values(discountCodeFixtures).find(
            (fixture) => fixture.id === id && "creditPerRun" in fixture
          )?.creditPerRun?.value,
        }))
      );
      expect(seeded.targets.length).toBeGreaterThan(0);

      // Drift that an earlier run or a manual edit can leave behind.
      const [partialDiscountId] = (
        await pool.query<{ discount_id: string }>(
          "select discount_id from discount_codes where id = $1",
          [discountCodeFixtures.partial.id]
        )
      ).rows.map(({ discount_id }) => discount_id);
      await pool.query(
        "insert into discount_targets (discount_id, product_target) values ($1, $2)",
        [partialDiscountId, JSON.stringify({ kind: "meeting-room" })]
      );
      await pool.query(
        "update discount_codes set enabled = false where id = $1",
        [discountCodeFixtures.partial.id]
      );
      await pool.query(
        "update promotion_codes set enabled = false where id = $1",
        [discountCodeFixtures.voucherFull.id]
      );
      await pool.query(
        "insert into promotion_code_customers (promotion_code_id, dotypos_customer_id) values ($1, 'workspace-e2e-stale-customer')",
        [discountCodeFixtures.onePerCustomer.id]
      );

      await seed();
      expect(await snapshot()).toEqual(seeded);
    });
  }
);
