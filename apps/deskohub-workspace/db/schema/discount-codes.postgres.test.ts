import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { PoolClient } from "pg";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

/** Runs the scenario in a transaction that always rolls back. */
const withDiscount = async (
  scenario: (client: PoolClient) => Promise<void>
) => {
  const client = await postgresDatabase!.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into discounts (id, labels, percentage_basis_points)
       values ('service-date-discount', '{}', 1000)`
    );
    await scenario(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
};

const insertCode = (
  client: PoolClient,
  code: string,
  serviceDateFrom: string | null,
  serviceDateUntil: string | null
) =>
  client.query(
    `insert into discount_codes (code, enabled, discount_id, service_date_from, service_date_until)
     values ($1, true, 'service-date-discount', $2, $3)`,
    [code, serviceDateFrom, serviceDateUntil]
  );

describe.skipIf(!postgresDatabase)(
  "discount code service dates on Postgres",
  () => {
    test("stores no window, a one-day window, and an ordered window", async () => {
      await withDiscount(async (client) => {
        await insertCode(client, "SERVICE_NONE", null, null);
        await insertCode(client, "SERVICE_ONE_DAY", "2099-07-15", "2099-07-15");
        await insertCode(client, "SERVICE_JULY", "2099-07-01", "2099-07-31");

        const rows = await client.query(
          `select code, service_date_from::text as "from", service_date_until::text as "until"
             from discount_codes
            where code like 'SERVICE_%'
            order by code`
        );
        expect(rows.rows).toEqual([
          { code: "SERVICE_JULY", from: "2099-07-01", until: "2099-07-31" },
          { code: "SERVICE_NONE", from: null, until: null },
          { code: "SERVICE_ONE_DAY", from: "2099-07-15", until: "2099-07-15" },
        ]);
      });
    });

    test.each([
      ["only a first date", "2099-07-01", null],
      ["only a last date", null, "2099-07-31"],
      ["an inverted window", "2099-07-31", "2099-07-01"],
    ] as const)("rejects %s", async (_, serviceDateFrom, serviceDateUntil) => {
      await withDiscount(async (client) => {
        await expect(
          insertCode(
            client,
            "SERVICE_INVALID",
            serviceDateFrom,
            serviceDateUntil
          )
        ).rejects.toMatchObject({
          code: "23514",
          constraint: "discount_codes_service_date_window_check",
        });
      });
    });
  }
);
