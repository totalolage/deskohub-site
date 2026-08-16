import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { legalEvidenceEvents } from "./legal-evidence-events";

describe("legal evidence order ownership", () => {
  test("supports order-only evidence while retaining the reservation compatibility link", async () => {
    const config = getTableConfig(legalEvidenceEvents);
    const migration = await Bun.file(
      new URL(
        "../migrations/20260816191757_order_discount_legal_evidence/migration.sql",
        import.meta.url
      )
    ).text();

    expect(
      config.columns.find(({ name }) => name === "order_id")?.notNull
    ).toBe(false);
    expect(
      config.columns.find(({ name }) => name === "workspace_reservation_id")
        ?.notNull
    ).toBe(false);
    expect(config.checks.map(({ name }) => name)).toContain(
      "legal_evidence_events_order_ownership_check"
    );
    expect(migration).toContain('SET "order_id" = parent_order."id"');
    expect(migration).toContain(
      '"order_id" is not null or "workspace_reservation_id" is not null'
    );
    expect(migration).not.toMatch(
      /customer_(?:email|name)|access_code|raw_payload/
    );
  });
});
