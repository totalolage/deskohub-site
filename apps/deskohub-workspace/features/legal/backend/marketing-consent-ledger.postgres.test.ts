import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Clock, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  linkMigrationsBefore,
  withScratchDatabase,
  workspaceMigrationsFolder,
} from "@/db/migration-scratch-database.test-utils";
import { customerMarketingConsents } from "@/db/schema";
import type { Locale } from "@/features/i18n";
import { getLegalDocument } from "@/features/legal/content";
import { hashLegalDocument } from "@/features/legal/document-version";
import type { MarketingConsentGrantSource } from "@/features/legal/marketing-consent-grant-source";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type IMarketingConsentLedger,
  MarketingConsentLedger,
  type MarketingConsentRecord,
  type MarketingConsentUnavailable,
  marketingConsentState,
} from "./marketing-consent-ledger";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const makeLedgerLayer = () =>
  MarketingConsentLedger.Default.pipe(
    Layer.provide(
      Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(testDatabase!.db))
    )
  );

const uniqueCustomerId = () =>
  DotyposCustomerIdSchema.make(`marketing-consent-${crypto.randomUUID()}`);

/** The version the ledger must store: the published document's own hash. */
const marketingDocumentHash = (locale: Locale) =>
  hashLegalDocument(getLegalDocument(locale, "marketing-communications"));

/** A clock fixed at the instant, to its nanosecond. */
const clockAt = (instant: Temporal.Instant): Clock.Clock => ({
  currentTimeMillisUnsafe: () => instant.epochMilliseconds,
  currentTimeMillis: Effect.sync(() => instant.epochMilliseconds),
  currentTimeNanosUnsafe: () => instant.epochNanoseconds,
  currentTimeNanos: Effect.sync(() => instant.epochNanoseconds),
  sleep: () => Effect.void,
});

const runLedger = <A>(
  operation: (
    ledger: IMarketingConsentLedger
  ) => Effect.Effect<A, MarketingConsentUnavailable>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ledger = yield* MarketingConsentLedger;
      return yield* operation(ledger);
    }).pipe(Effect.provide(makeLedgerLayer()))
  );

/** Records the choice as the ledger would at `at`. */
const recordAt =
  (at: string, input: MarketingConsentRecord) =>
  (ledger: IMarketingConsentLedger) =>
    ledger
      .record(input)
      .pipe(
        Effect.provideService(Clock.Clock, clockAt(Temporal.Instant.from(at)))
      );

const withdrawActiveAt =
  (at: string, customerId: DotyposCustomerId) =>
  (ledger: IMarketingConsentLedger) =>
    ledger
      .withdrawActive(customerId)
      .pipe(
        Effect.provideService(Clock.Clock, clockAt(Temporal.Instant.from(at)))
      );

const grant = (
  customerId: DotyposCustomerId,
  mode: "initial" | "explicit",
  overrides: {
    readonly locale?: Locale;
    readonly channel?: MarketingConsentGrantSource;
  } = {}
): MarketingConsentRecord => ({
  customerId,
  locale: overrides.locale ?? "en-US",
  choice: "grant",
  mode,
  channel: overrides.channel ?? "reservation_form",
});

const withdraw = (
  customerId: DotyposCustomerId,
  locale: Locale = "en-US"
): MarketingConsentRecord => ({ customerId, locale, choice: "withdraw" });

const readStored = (customerId: DotyposCustomerId) =>
  Effect.runPromise(
    testDatabase!.db
      .select()
      .from(customerMarketingConsents)
      .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
  ).then(([row]) => row ?? null);

const expectStored = async (
  customerId: DotyposCustomerId,
  expected: {
    readonly locale: Locale;
    readonly grantedAt: string;
    readonly withdrawnAt: string | null;
    readonly channel: MarketingConsentGrantSource | null;
  }
) => {
  const stored = await readStored(customerId);
  expect(stored).not.toBeNull();
  if (!stored) throw new Error("Expected a stored marketing consent.");

  expect(stored.documentHash).toBe(marketingDocumentHash(expected.locale));
  expect(stored.locale).toBe(expected.locale);
  expect(
    stored.grantedAt.equals(Temporal.Instant.from(expected.grantedAt))
  ).toBe(true);
  expect(stored.grantSource).toBe(expected.channel);
  if (expected.withdrawnAt) {
    expect(
      stored.withdrawnAt?.equals(Temporal.Instant.from(expected.withdrawnAt))
    ).toBe(true);
  } else {
    expect(stored.withdrawnAt).toBeNull();
  }
};

describe.skipIf(!testDatabase)(
  "MarketingConsentLedger on disposable Postgres",
  () => {
    test("records the hash of the locale's published marketing document", async () => {
      const czech = uniqueCustomerId();
      const english = uniqueCustomerId();

      await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            grant(czech, "initial", { locale: "cs-CZ" })
          )(ledger);
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            grant(english, "explicit", { locale: "en-US", channel: "account" })
          )(ledger);
        })
      );

      expect(marketingDocumentHash("cs-CZ")).not.toBe(
        marketingDocumentHash("en-US")
      );
      await expectStored(czech, {
        locale: "cs-CZ",
        grantedAt: "2026-09-01T10:00:00Z",
        withdrawnAt: null,
        channel: "reservation_form",
      });
      await expectStored(english, {
        locale: "en-US",
        grantedAt: "2026-09-01T10:00:00Z",
        withdrawnAt: null,
        channel: "account",
      });
    });

    test("an initial grant never overwrites an active or withdrawn consent", async () => {
      const activeCustomerId = uniqueCustomerId();
      const withdrawnCustomerId = uniqueCustomerId();

      const statuses = await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            grant(activeCustomerId, "initial", {
              locale: "en-US",
              channel: "reservation_form",
            })
          )(ledger);
          yield* recordAt(
            "2026-09-02T10:00:00Z",
            grant(activeCustomerId, "initial", {
              locale: "cs-CZ",
              channel: "site_tool",
            })
          )(ledger);

          yield* recordAt(
            "2026-09-01T11:00:00Z",
            grant(withdrawnCustomerId, "initial", {
              locale: "cs-CZ",
              channel: "site_tool",
            })
          )(ledger);
          yield* recordAt(
            "2026-09-03T11:00:00Z",
            withdraw(withdrawnCustomerId)
          )(ledger);
          yield* recordAt(
            "2026-09-04T11:00:00Z",
            grant(withdrawnCustomerId, "initial", { channel: "mcp_tool" })
          )(ledger);

          return [
            yield* ledger.status(activeCustomerId),
            yield* ledger.status(withdrawnCustomerId),
          ];
        })
      );

      expect(statuses).toEqual(["active", "withdrawn"]);
      await expectStored(activeCustomerId, {
        locale: "en-US",
        grantedAt: "2026-09-01T10:00:00Z",
        withdrawnAt: null,
        channel: "reservation_form",
      });
      await expectStored(withdrawnCustomerId, {
        locale: "cs-CZ",
        grantedAt: "2026-09-01T11:00:00Z",
        withdrawnAt: "2026-09-03T11:00:00Z",
        channel: "site_tool",
      });
    });

    test("an explicit grant renews the evidence and reactivates a withdrawn consent", async () => {
      const customerId = uniqueCustomerId();

      const { renewed, reactivated } = await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            grant(customerId, "initial", { channel: "site_tool" })
          )(ledger);
          yield* recordAt(
            "2026-09-02T10:00:00Z",
            grant(customerId, "explicit", {
              locale: "cs-CZ",
              channel: "account",
            })
          )(ledger);
          const renewed = yield* ledger.status(customerId);
          yield* recordAt("2026-09-03T10:00:00Z", withdraw(customerId))(ledger);
          yield* recordAt(
            "2026-09-04T10:00:00Z",
            grant(customerId, "explicit", { channel: "link" })
          )(ledger);
          return { renewed, reactivated: yield* ledger.status(customerId) };
        })
      );

      expect(renewed).toBe("active");
      expect(reactivated).toBe("active");
      await expectStored(customerId, {
        locale: "en-US",
        grantedAt: "2026-09-04T10:00:00Z",
        withdrawnAt: null,
        channel: "link",
      });
    });

    test("a grant older than the recorded withdrawal does not reactivate consent", async () => {
      const customerId = uniqueCustomerId();

      const status = await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            grant(customerId, "initial")
          )(ledger);
          yield* recordAt("2026-09-05T10:00:00Z", withdraw(customerId))(ledger);
          yield* recordAt(
            "2026-09-04T10:00:00Z",
            grant(customerId, "explicit", { channel: "account" })
          )(ledger);
          return yield* ledger.status(customerId);
        })
      );

      expect(status).toBe("withdrawn");
      await expectStored(customerId, {
        locale: "en-US",
        grantedAt: "2026-09-01T10:00:00Z",
        withdrawnAt: "2026-09-05T10:00:00Z",
        channel: "reservation_form",
      });
    });

    test("a grant within the withdrawal's millisecond but after it reactivates consent", async () => {
      const customerId = uniqueCustomerId();

      const status = await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            grant(customerId, "initial")
          )(ledger);
          yield* recordAt(
            "2026-09-05T10:00:00.000100Z",
            withdraw(customerId)
          )(ledger);
          yield* recordAt(
            "2026-09-05T10:00:00.000900Z",
            grant(customerId, "explicit", { channel: "account" })
          )(ledger);
          return yield* ledger.status(customerId);
        })
      );

      expect(status).toBe("active");
      await expectStored(customerId, {
        locale: "en-US",
        grantedAt: "2026-09-05T10:00:00.000900Z",
        withdrawnAt: null,
        channel: "account",
      });
    });

    test("a withdrawal without a consent blocks a later initial grant", async () => {
      const customerId = uniqueCustomerId();

      const status = await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            withdraw(customerId, "cs-CZ")
          )(ledger);
          yield* recordAt(
            "2026-09-02T10:00:00Z",
            grant(customerId, "initial")
          )(ledger);
          return yield* ledger.status(customerId);
        })
      );

      expect(status).toBe("withdrawn");
      await expectStored(customerId, {
        locale: "cs-CZ",
        grantedAt: "2026-09-01T10:00:00Z",
        withdrawnAt: "2026-09-01T10:00:00Z",
        channel: null,
      });
    });

    test("a concurrent initial grant and withdrawal leave the withdrawal recorded", async () => {
      const customerId = uniqueCustomerId();

      await Promise.all([
        runLedger(
          recordAt("2026-09-07T10:00:00Z", grant(customerId, "initial"))
        ),
        runLedger(recordAt("2026-09-08T10:00:00Z", withdraw(customerId))),
      ]);

      const stored = await readStored(customerId);
      expect(
        stored?.withdrawnAt?.equals(
          Temporal.Instant.from("2026-09-08T10:00:00Z")
        )
      ).toBe(true);
    });

    test("withdrawal timestamps are monotonic and keep the consent evidence", async () => {
      const customerId = uniqueCustomerId();

      await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-10T10:00:00Z",
            grant(customerId, "initial", { channel: "site_tool" })
          )(ledger);
          yield* recordAt(
            "2026-09-09T10:00:00Z",
            withdraw(customerId, "cs-CZ")
          )(ledger);
        })
      );
      await expectStored(customerId, {
        locale: "en-US",
        grantedAt: "2026-09-10T10:00:00Z",
        withdrawnAt: "2026-09-10T10:00:00Z",
        channel: "site_tool",
      });

      await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-12T10:00:00Z",
            withdraw(customerId, "cs-CZ")
          )(ledger);
          yield* recordAt("2026-09-11T10:00:00Z", withdraw(customerId))(ledger);
        })
      );
      await expectStored(customerId, {
        locale: "en-US",
        grantedAt: "2026-09-10T10:00:00Z",
        withdrawnAt: "2026-09-12T10:00:00Z",
        channel: "site_tool",
      });
    });

    test("withdrawing an active consent keeps its evidence and reports it once", async () => {
      const customerId = uniqueCustomerId();
      const absentCustomerId = uniqueCustomerId();

      const outcomes = await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            grant(customerId, "explicit", { channel: "link" })
          )(ledger);
          return [
            yield* withdrawActiveAt(
              "2026-09-02T10:00:00.000900Z",
              customerId
            )(ledger),
            yield* withdrawActiveAt("2026-09-03T10:00:00Z", customerId)(ledger),
            yield* withdrawActiveAt(
              "2026-09-03T10:00:00Z",
              absentCustomerId
            )(ledger),
            yield* ledger.status(absentCustomerId),
          ];
        })
      );

      expect(outcomes).toEqual([true, false, false, "absent"]);
      await expectStored(customerId, {
        locale: "en-US",
        grantedAt: "2026-09-01T10:00:00Z",
        // One-click unsubscribe records the millisecond.
        withdrawnAt: "2026-09-02T10:00:00Z",
        channel: "link",
      });
      expect(await readStored(absentCustomerId)).toBeNull();
    });

    // The administration suite covers the fragment over reservations,
    // including customers without a consent.
    test("marketingConsentState reads a consent query's own rows by their key", async () => {
      const active = uniqueCustomerId();
      const withdrawn = uniqueCustomerId();

      await runLedger((ledger) =>
        Effect.gen(function* () {
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            grant(active, "initial")
          )(ledger);
          yield* recordAt(
            "2026-09-01T10:00:00Z",
            grant(withdrawn, "initial")
          )(ledger);
          yield* recordAt("2026-09-02T10:00:00Z", withdraw(withdrawn))(ledger);
        })
      );

      const rows = await Effect.runPromise(
        testDatabase!.db
          .select({
            dotyposCustomerId: customerMarketingConsents.dotyposCustomerId,
            state: marketingConsentState(
              customerMarketingConsents.dotyposCustomerId
            ),
          })
          .from(customerMarketingConsents)
          .where(
            inArray(customerMarketingConsents.dotyposCustomerId, [
              active,
              withdrawn,
            ])
          )
      );
      expect(
        Object.fromEntries(
          rows.map((row) => [row.dotyposCustomerId, row.state])
        )
      ).toEqual({ [active]: "active", [withdrawn]: "withdrawn" });
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
