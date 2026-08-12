import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { mobileSessionHandoffCodes } from "./mobile-session-handoffs";

describe("mobile session handoff persistence", () => {
  test("stores only a one-time code digest and expiry", () => {
    const config = getTableConfig(mobileSessionHandoffCodes);

    expect(config.name).toBe("mobile_session_handoff_codes");
    expect(config.columns.map(({ name }) => name)).toEqual([
      "code_hash",
      "created_at",
      "expires_at",
    ]);
    expect(
      config.columns.find(({ name }) => name === "code_hash")?.primary
    ).toBe(true);
    expect(config.foreignKeys).toHaveLength(0);
    expect(config.indexes.map(({ config: { name } }) => name)).toEqual([
      "mobile_session_handoff_codes_expires_at_idx",
    ]);
    expect(config.checks.map(({ name }) => name)).toEqual([
      "mobile_session_handoff_codes_hash_check",
      "mobile_session_handoff_codes_expiry_check",
    ]);
  });

  test("generated migration is additive and contains no session material", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260812083629_glossy_mastermind/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain('CREATE TABLE "mobile_session_handoff_codes"');
    expect(migration).toContain('"code_hash" text PRIMARY KEY');
    expect(migration).toContain(
      'CREATE INDEX "mobile_session_handoff_codes_expires_at_idx"'
    );
    expect(migration).not.toContain("DROP ");
    expect(migration).not.toContain("discount_targets");
    expect(migration).not.toContain("session_cookie");
    expect(migration).not.toContain('"email"');
    expect(migration).not.toContain('"verifier"');
  });
});
