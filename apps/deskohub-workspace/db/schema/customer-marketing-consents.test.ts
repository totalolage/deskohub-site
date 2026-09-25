import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { CustomerMarketingConsentRepository } from "../../features/legal/backend/customer-marketing-consent.repository";
import { customerMarketingConsents } from "./customer-marketing-consents";

describe("customer marketing consent persistence", () => {
  test("stores one minimal consent record per Dotypos customer", () => {
    const config = getTableConfig(customerMarketingConsents);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column])
    );

    expect(config.columns.map(({ name }) => name)).toEqual([
      "dotypos_customer_id",
      "document_hash",
      "locale",
      "granted_at",
      "withdrawn_at",
    ]);
    expect(columns.dotypos_customer_id?.primary).toBe(true);
    expect(columns.dotypos_customer_id?.notNull).toBe(true);
    expect(columns.document_hash?.notNull).toBe(true);
    expect(columns.locale?.notNull).toBe(true);
    expect(columns.granted_at?.notNull).toBe(true);
    expect(columns.withdrawn_at?.notNull).toBe(false);
    expect(config.foreignKeys).toHaveLength(0);
    expect(config.indexes).toHaveLength(0);
    expect(config.checks.map(({ name }) => name)).toEqual([
      "customer_marketing_consents_customer_check",
      "customer_marketing_consents_locale_check",
      "customer_marketing_consents_withdrawal_check",
    ]);
  });

  test("distinguishes initial and explicit consent grants", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const repository = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* CustomerMarketingConsentRepository;
      }).pipe(
        Effect.provide(
          CustomerMarketingConsentRepository.Default.pipe(
            Layer.provide(recording.layer)
          )
        )
      )
    );
    const grantInput = {
      dotyposCustomerId: "dotypos-customer-1" as never,
      documentHash: "hash-1",
      locale: "en-US" as never,
      grantedAt: "2026-01-01T00:00:00.000Z" as never,
    };

    await Effect.runPromise(repository.grantInitial(grantInput));
    await Effect.runPromise(repository.grant(grantInput));

    expect(recording.statements).toHaveLength(2);
    const [initialSql, explicitSql] = recording.statements.map(
      ({ sql }) => sql
    );

    // An initial grant never overwrites an existing consent row.
    expect(initialSql).toContain("on conflict do nothing");

    // An explicit grant re-activates a withdrawn consent in place.
    expect(explicitSql).toContain("on conflict");
    expect(explicitSql).toContain('"dotypos_customer_id"');
    expect(explicitSql).toContain('"withdrawn_at" = $');
    const explicitParams = recording.statements[1].params;
    expect(explicitParams).toContain(null);
    expect(explicitParams).toContain("hash-1");
  });

  test("creates the customer table without a historical backfill", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260810091934_ordinary_odin/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain('CREATE TABLE "customer_marketing_consents"');
    expect(migration).toContain('"dotypos_customer_id" text PRIMARY KEY');
    expect(migration).not.toContain("INSERT INTO");
    expect(migration).not.toContain("legal_evidence_events");
  });
});
