import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  linkMigrationsBefore,
  withScratchDatabase,
  workspaceMigrationsFolder,
} from "@/db/migration-scratch-database.test-utils";
import { customerMarketingConsents } from "@/db/schema";
import type { CustomerMarketingConsent } from "@/db/schema/customer-marketing-consents";
import type { MarketingConsentGrantSource } from "@/features/legal/marketing-consent-grant-source";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  CustomerMarketingConsentRepository,
  type GrantCustomerMarketingConsentInput,
  type ICustomerMarketingConsentRepository,
} from "./customer-marketing-consent.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const makeRepositoryLayer = () =>
  CustomerMarketingConsentRepository.Default.pipe(
    Layer.provide(
      Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db: testDatabase!.db })
      )
    )
  );

const uniqueCustomerId = () =>
  DotyposCustomerIdSchema.make(`marketing-consent-${crypto.randomUUID()}`);

const makeInput = (
  dotyposCustomerId = uniqueCustomerId(),
  overrides: Partial<
    Omit<GrantCustomerMarketingConsentInput, "dotyposCustomerId">
  > = {}
): GrantCustomerMarketingConsentInput => ({
  dotyposCustomerId,
  documentHash: `document-${crypto.randomUUID()}`,
  locale: "en-US",
  grantedAt: Temporal.Instant.from("2026-09-01T10:00:00Z"),
  source: "reservation_form",
  ...overrides,
});

const runRepository = <A>(
  operation: (
    repository: ICustomerMarketingConsentRepository
  ) => Effect.Effect<A, EffectDrizzleQueryError>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* CustomerMarketingConsentRepository;
      return yield* operation(repository);
    }).pipe(Effect.provide(makeRepositoryLayer()))
  );

const expectConsent = (
  actual: CustomerMarketingConsent | null,
  expected: {
    readonly dotyposCustomerId: GrantCustomerMarketingConsentInput["dotyposCustomerId"];
    readonly documentHash: string;
    readonly locale: GrantCustomerMarketingConsentInput["locale"];
    readonly grantedAt: Temporal.Instant;
    readonly withdrawnAt: Temporal.Instant | null;
    readonly source: MarketingConsentGrantSource | null;
  }
) => {
  expect(actual).not.toBeNull();
  if (!actual) throw new Error("Expected a stored marketing consent.");

  expect(actual.dotyposCustomerId).toBe(expected.dotyposCustomerId);
  expect(actual.documentHash).toBe(expected.documentHash);
  expect(actual.locale).toBe(expected.locale);
  expect(actual.grantedAt.equals(expected.grantedAt)).toBe(true);
  expect(actual.grantSource).toBe(expected.source);
  if (expected.withdrawnAt) {
    expect(actual.withdrawnAt?.equals(expected.withdrawnAt)).toBe(true);
  } else {
    expect(actual.withdrawnAt).toBeNull();
  }
};

describe.skipIf(!testDatabase)(
  "CustomerMarketingConsentRepository on disposable Postgres",
  () => {
    test("initial grants preserve every field, including the source, for active and withdrawn records", async () => {
      const activeCustomerId = uniqueCustomerId();
      const activeInitial = makeInput(activeCustomerId, {
        documentHash: "active-initial-document",
        locale: "en-US",
        grantedAt: Temporal.Instant.from("2026-09-01T10:00:00Z"),
        source: "reservation_form",
      });
      const activeRetry = makeInput(activeCustomerId, {
        documentHash: "active-retry-document",
        locale: "cs-CZ",
        grantedAt: Temporal.Instant.from("2026-09-02T10:00:00Z"),
        source: "site_tool",
      });

      const withdrawnCustomerId = uniqueCustomerId();
      const withdrawnInitial = makeInput(withdrawnCustomerId, {
        documentHash: "withdrawn-initial-document",
        locale: "cs-CZ",
        grantedAt: Temporal.Instant.from("2026-09-01T11:00:00Z"),
        source: "site_tool",
      });
      const withdrawal = makeInput(withdrawnCustomerId, {
        documentHash: "withdrawal-request-document",
        locale: "en-US",
        grantedAt: Temporal.Instant.from("2026-09-03T11:00:00Z"),
      });
      const withdrawnRetry = makeInput(withdrawnCustomerId, {
        documentHash: "withdrawn-retry-document",
        locale: "en-US",
        grantedAt: Temporal.Instant.from("2026-09-04T11:00:00Z"),
        source: "reservation_form",
      });

      const [active, withdrawn] = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.grantInitial(activeInitial);
          yield* repository.grantInitial(activeRetry);
          yield* repository.grantInitial(withdrawnInitial);
          yield* repository.withdraw(withdrawal);
          yield* repository.grantInitial(withdrawnRetry);
          return yield* Effect.all([
            repository.get(activeCustomerId),
            repository.get(withdrawnCustomerId),
          ]);
        })
      );

      expectConsent(active, {
        ...activeInitial,
        withdrawnAt: null,
      });
      expectConsent(withdrawn, {
        ...withdrawnInitial,
        withdrawnAt: withdrawal.grantedAt,
      });
    });

    test("explicit grants update evidence and source and reactivate withdrawn records", async () => {
      const customerId = uniqueCustomerId();
      const initial = makeInput(customerId, {
        documentHash: "initial-document",
        locale: "en-US",
        grantedAt: Temporal.Instant.from("2026-09-01T12:00:00Z"),
        source: "reservation_form",
      });
      const activeUpdate = makeInput(customerId, {
        documentHash: "active-update-document",
        locale: "cs-CZ",
        grantedAt: Temporal.Instant.from("2026-09-02T12:00:00Z"),
        source: "account",
      });
      const withdrawal = makeInput(customerId, {
        documentHash: "ignored-withdrawal-document",
        locale: "en-US",
        grantedAt: Temporal.Instant.from("2026-09-03T12:00:00Z"),
      });
      const explicitGrant = makeInput(customerId, {
        documentHash: "explicit-grant-document",
        locale: "en-US",
        grantedAt: Temporal.Instant.from("2026-09-04T12:00:00Z"),
        source: "link",
      });

      const { active, reactivated } = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.grantInitial(initial);
          yield* repository.grant(activeUpdate);
          const active = yield* repository.get(customerId);
          yield* repository.withdraw(withdrawal);
          yield* repository.grant(explicitGrant);
          const reactivated = yield* repository.get(customerId);
          return { active, reactivated };
        })
      );

      expectConsent(active, {
        ...activeUpdate,
        withdrawnAt: null,
      });
      expectConsent(reactivated, {
        ...explicitGrant,
        withdrawnAt: null,
      });
    });

    test("a grant older than the recorded withdrawal does not reactivate consent", async () => {
      const customerId = uniqueCustomerId();
      const initial = makeInput(customerId, {
        documentHash: "stale-grant-initial-document",
        grantedAt: Temporal.Instant.from("2026-09-01T12:00:00Z"),
      });
      const staleGrant = makeInput(customerId, {
        documentHash: "stale-grant-document",
        grantedAt: Temporal.Instant.from("2026-09-02T12:00:00Z"),
        source: "account",
      });
      const withdrawal = makeInput(customerId, {
        documentHash: "newer-withdrawal-document",
        grantedAt: Temporal.Instant.from("2026-09-02T12:00:01Z"),
      });

      const consent = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.grantInitial(initial);
          yield* repository.withdraw(withdrawal);
          yield* repository.grant(staleGrant);
          return yield* repository.get(customerId);
        })
      );

      expectConsent(consent, {
        ...initial,
        withdrawnAt: withdrawal.grantedAt,
      });
    });

    test("an absent withdrawal creates a tombstone that blocks an initial grant", async () => {
      const customerId = uniqueCustomerId();
      const withdrawal = makeInput(customerId, {
        documentHash: "tombstone-document",
        locale: "cs-CZ",
        grantedAt: Temporal.Instant.from("2026-09-05T10:00:00Z"),
      });
      const initial = makeInput(customerId, {
        documentHash: "late-initial-document",
        locale: "en-US",
        grantedAt: Temporal.Instant.from("2026-09-06T10:00:00Z"),
      });

      const consent = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.withdraw(withdrawal);
          yield* repository.grantInitial(initial);
          return yield* repository.get(customerId);
        })
      );

      expectConsent(consent, {
        ...withdrawal,
        withdrawnAt: withdrawal.grantedAt,
        source: null,
      });
    });

    test("a concurrent initial grant and withdrawal leave the withdrawal recorded", async () => {
      const customerId = uniqueCustomerId();
      const initial = makeInput(customerId, {
        documentHash: "concurrent-initial-document",
        grantedAt: Temporal.Instant.from("2026-09-07T10:00:00Z"),
      });
      const withdrawal = makeInput(customerId, {
        documentHash: "concurrent-withdrawal-document",
        grantedAt: Temporal.Instant.from("2026-09-08T10:00:00Z"),
      });

      await runRepository((repository) =>
        Effect.all(
          [repository.grantInitial(initial), repository.withdraw(withdrawal)],
          { concurrency: "unbounded" }
        )
      );
      const consent = await runRepository((repository) =>
        repository.get(customerId)
      );

      expect(consent).not.toBeNull();
      if (!consent) throw new Error("Expected a concurrent consent row.");
      expect(consent.withdrawnAt?.equals(withdrawal.grantedAt)).toBe(true);
    });

    test("withdrawal timestamps are monotonic and do not replace consent evidence", async () => {
      const customerId = uniqueCustomerId();
      const initial = makeInput(customerId, {
        documentHash: "monotonic-initial-document",
        locale: "en-US",
        grantedAt: Temporal.Instant.from("2026-09-10T10:00:00Z"),
        source: "site_tool",
      });
      const olderWithdrawal = makeInput(customerId, {
        documentHash: "older-withdrawal-document",
        locale: "cs-CZ",
        grantedAt: Temporal.Instant.from("2026-09-09T10:00:00Z"),
      });
      const latestWithdrawal = makeInput(customerId, {
        documentHash: "latest-withdrawal-document",
        locale: "cs-CZ",
        grantedAt: Temporal.Instant.from("2026-09-12T10:00:00Z"),
      });
      const staleWithdrawal = makeInput(customerId, {
        documentHash: "stale-withdrawal-document",
        locale: "en-US",
        grantedAt: Temporal.Instant.from("2026-09-11T10:00:00Z"),
      });

      const { afterOlder, final } = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.grantInitial(initial);
          yield* repository.withdraw(olderWithdrawal);
          const afterOlder = yield* repository.get(customerId);
          yield* repository.withdraw(latestWithdrawal);
          yield* repository.withdraw(staleWithdrawal);
          const final = yield* repository.get(customerId);
          return { afterOlder, final };
        })
      );

      expectConsent(afterOlder, {
        ...initial,
        withdrawnAt: initial.grantedAt,
      });
      expectConsent(final, {
        ...initial,
        withdrawnAt: latestWithdrawal.grantedAt,
      });
    });

    test("withdrawing an active consent keeps its source", async () => {
      const customerId = uniqueCustomerId();
      const initial = makeInput(customerId, { source: "link" });
      const withdrawnAt = Temporal.Instant.from("2026-09-02T10:00:00Z");

      const consent = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.grantInitial(initial);
          yield* repository.withdrawActive({
            dotyposCustomerId: customerId,
            withdrawnAt,
          });
          return yield* repository.get(customerId);
        })
      );

      expectConsent(consent, { ...initial, withdrawnAt });
    });

    test("the database rejects an unknown grant source", async () => {
      await expect(
        testDatabase!.pool.query(
          `insert into customer_marketing_consents
             (dotypos_customer_id, document_hash, locale, granted_at, grant_source)
           values ($1, 'document', 'en-US', now(), 'webmcp')`,
          [uniqueCustomerId()]
        )
      ).rejects.toThrow("customer_marketing_consents_grant_source_check");
    });
  }
);

const GRANT_SOURCE_MIGRATION_DIR =
  "20261019124424_customer_marketing_consent_grant_source";
const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("grant source migration", () => {
  test("leaves grants recorded before it with an unknown source", async () => {
    const earlierMigrations = await linkMigrationsBefore(
      GRANT_SOURCE_MIGRATION_DIR
    );
    try {
      await withScratchDatabase(
        testDatabaseUrl!,
        "marketing_consent_grant_source_migration",
        async (pool) => {
          await migrate(drizzle({ client: pool }), {
            migrationsFolder: earlierMigrations,
          });
          const customerId = uniqueCustomerId();
          await pool.query(
            `insert into customer_marketing_consents
               (dotypos_customer_id, document_hash, locale, granted_at)
             values ($1, 'document', 'en-US', now())`,
            [customerId]
          );

          await migrate(drizzle({ client: pool }), {
            migrationsFolder: workspaceMigrationsFolder,
          });

          const rows = await drizzle({ client: pool })
            .select({ grantSource: customerMarketingConsents.grantSource })
            .from(customerMarketingConsents);
          expect(rows).toEqual([{ grantSource: null }]);
        }
      );
    } finally {
      await rm(earlierMigrations, { recursive: true, force: true });
    }
  });
});
