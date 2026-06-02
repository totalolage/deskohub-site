import { describe, expect, test } from "bun:test";

describe("0003 early reservation lifecycle migration", () => {
  test("backfills legacy Dotypos reservations as confirmed", async () => {
    const sql = await Bun.file(
      "apps/deskohub-workspace/db/migrations/0003_early_reservation_lifecycle.sql"
    ).text();

    expect(sql).toContain(
      "UPDATE \"payment_orders\" SET \"dotypos_reservation_status\" = 'CONFIRMED'"
    );
    expect(sql).toContain(
      "WHERE \"dotypos_reservation_id\" is not null"
    );
    expect(sql).toContain("\"reservation_confirmed_at\" = COALESCE");
  });
});
