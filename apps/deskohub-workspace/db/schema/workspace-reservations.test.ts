import { describe, expect, test } from "bun:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { workspaceReservations } from "./workspace-reservations";

describe("workspace reservations active customer email delivery", () => {
  test("keeps a prior delivery id while fulfillment is reclaimed into processing", () => {
    const config = getTableConfig(workspaceReservations);
    const check = config.checks.find(
      ({ name }) =>
        name === "workspace_reservations_active_email_delivery_state_check"
    );

    expect(check).toBeDefined();
    const checkSql = new PgDialect().sqlToQuery(check!.value).sql;

    expect(checkSql).toContain("'processing'");
    expect(checkSql.indexOf("'processing'")).toBeLessThan(
      checkSql.indexOf("'awaiting_delivery'")
    );
    expect(checkSql).toContain("'fulfilled'");
  });

  test("still requires a delivery id only once fulfillment awaits the webhook", () => {
    const config = getTableConfig(workspaceReservations);
    expect(config.checks.map(({ name }) => name)).toContain(
      "workspace_reservations_awaiting_delivery_check"
    );
  });

  test("creates the final delivery state check in the single migration", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260831172449_wooden_carnage/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).not.toContain(
      'DROP CONSTRAINT "workspace_reservations_active_email_delivery_state_check"'
    );
    expect(migration).toContain(
      `ADD CONSTRAINT "workspace_reservations_active_email_delivery_state_check" CHECK ("active_customer_email_delivery_id" is null or "fulfillment_state" in ('processing', 'awaiting_delivery', 'failed', 'fulfilled'))`
    );
  });
});
