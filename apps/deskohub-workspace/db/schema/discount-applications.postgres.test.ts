import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { PoolClient } from "pg";
import {
  connectWorkspacePostgresTestDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const customerId = "synthetic-claim-customer";

/** Seeds three synthetic checkouts, one discount code and one voucher. */
const seedClaimTargets = async (client: PoolClient) => {
  await client.query(
    `insert into workspace_reservations (id, checkout_attempt_key, dotypos_customer_id, dotypos_reservation_id, reservation_state, payment_state, fulfillment_state, reservation_details, locale, author_account_id)
     select 'claim-reservation-' || n, 'claim-attempt-key-' || n, $1, 'claim-booking-' || n, 'cancelled', 'expired', 'not_started', '{"kind":"cowork","entryTier":"open-space","coffee":false}', 'en-US', $2
       from generate_series(1, 3) n`,
    [customerId, fixtureReservationAuthorId]
  );
  await client.query(
    `insert into payment_attempts (id, workspace_reservation_id, provider, provider_order_id, state, failure_code, refund_state, amount_value, amount_exponent, currency)
     select 'claim-attempt-' || n, 'claim-reservation-' || n, 'nexi', 'claim-order-' || n, 'expired', 'payment_abandoned_after_provider_cutoff', 'not_required', 29000, 2, 'CZK'
       from generate_series(1, 3) n`
  );
  await client.query(
    `insert into discount_applications (id, payment_attempt_id, workspace_reservation_id, sequence, public_discount_id, label, adjustment, product_identity, subtotal_before_value, subtotal_before_exponent, subtotal_before_currency, applied_amount_value, applied_amount_exponent, applied_amount_currency, subtotal_after_value, subtotal_after_exponent, subtotal_after_currency, provenance)
     select 'claim-application-' || n, 'claim-attempt-' || n, 'claim-reservation-' || n, 0, 'synthetic-discount', 'Synthetic', '{}', '{}', 29000, 2, 'CZK', 1000, 2, 'CZK', 28000, 2, 'CZK', '{}'
       from generate_series(1, 3) n`
  );
  await client.query(
    `insert into discounts (id, labels, percentage_basis_points)
     values ('claim-discount', '{}', 1000)`
  );
  await client.query(
    `insert into discount_codes (id, code, enabled, discount_id)
     values ('claim-code', 'SYNTHETIC_CLAIM_CODE', true, 'claim-discount')`
  );
  await client.query(
    `insert into promotion_codes (id, kind, code, enabled)
     values ('claim-voucher-promotion', 'voucher', 'SYNTHETIC_CLAIM_VOUCHER', true)`
  );
  await client.query(
    `insert into vouchers (id, promotion_code_id, issued_amount_value, issued_amount_exponent, issued_amount_currency)
     values ('claim-voucher', 'claim-voucher-promotion', 1000, 2, 'CZK')`
  );
};

const reserveClaim = (
  client: PoolClient,
  table: "discount_code_redemptions" | "voucher_redemptions",
  checkout: number
) =>
  client.query(
    `insert into ${table} (id, ${table === "voucher_redemptions" ? "voucher_id" : "code_id"}, application_id, payment_attempt_id, dotypos_customer_id, state, reservation_expires_at)
     values ($1, $2, 'claim-application-' || $3::int, 'claim-attempt-' || $3::int, $4, 'reserved', now() + interval '1 hour')`,
    [
      `${table}-${checkout}`,
      table === "voucher_redemptions" ? "claim-voucher" : "claim-code",
      checkout,
      customerId,
    ]
  );

/** Runs the scenario in a transaction that always rolls back. */
const withClaimTargets = async (
  scenario: (client: PoolClient) => Promise<void>
) => {
  const client = await postgresDatabase!.pool.connect();
  try {
    await client.query("begin");
    await seedClaimTargets(client);
    await scenario(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
};

describe.skipIf(!postgresDatabase)("discount claims on Postgres", () => {
  test("lets a customer hold several active claims on an ordinary discount code", async () => {
    await withClaimTargets(async (client) => {
      await reserveClaim(client, "discount_code_redemptions", 1);
      await reserveClaim(client, "discount_code_redemptions", 2);

      const claims = await client.query(
        `select 1 from discount_code_redemptions
          where code_id = 'claim-code' and state = 'reserved'`
      );
      expect(claims.rowCount).toBe(2);
    });
  });

  test("allows one active voucher claim per customer until it is released", async () => {
    await withClaimTargets(async (client) => {
      await reserveClaim(client, "voucher_redemptions", 1);

      await client.query("savepoint second_claim");
      await expect(
        reserveClaim(client, "voucher_redemptions", 2)
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "voucher_redemptions_active_customer_unique_idx",
      });
      await client.query("rollback to savepoint second_claim");

      await client.query(
        `update voucher_redemptions
            set state = 'released', released_at = now(), release_reason = 'expired'
          where id = 'voucher_redemptions-1'`
      );
      await reserveClaim(client, "voucher_redemptions", 2);
    });
  });
});
