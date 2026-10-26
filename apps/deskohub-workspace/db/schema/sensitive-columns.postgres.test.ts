/**
 * Drives every `sensitiveText` column through the real query logger against
 * Postgres: an insert, an update, an `onConflictDoUpdate` set, and `eq`,
 * `ne`, and `inArray` predicates. The log must never carry a written or
 * compared value, and Postgres must store each one as written, since the
 * encoder marks values without changing them.
 *
 * Each table with a sensitive column needs a row fixture here, so a new
 * sensitive table fails until it has one. A new sensitive column on a table
 * that has one is covered at once; when the fixture's row breaks a constraint
 * on the new column, extend the fixture.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  and,
  eq,
  getTableColumns,
  type InferInsertModel,
  inArray,
  ne,
} from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { Cause, Effect, Exit } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  captureDatabaseQueryLogsWithExit,
  expectQueryLogsToOmit,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  withHeldTransaction,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  authAccount,
  authOauthAccessToken,
  authOauthClient,
  authOauthRefreshToken,
  authPasskey,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
} from "./auth";
import {
  administrationActions,
  administratorAssistantConnections,
  cliAuthenticationRequests,
  cliSessions,
  customerMarketingManagementTokens,
  discountCodes,
  discounts,
  emailCampaignConfirmationCodes,
  emailCampaigns,
  invoices,
  manualInvoiceActors,
  paymentAttempts,
  promotionCodes,
  reservationAccessGrants,
  standaloneAccessCodeAttemptEvents,
} from "./index";
import { schemaColumns } from "./schema-columns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const sensitiveColumns = schemaColumns.filter(({ sensitive }) => sensitive);

/** Turns a unique seed into a value the column's constraints accept. */
type SyntheticValue = (seed: string) => string;

const syntheticText: SyntheticValue = (seed) => `synthetic-sensitive-${seed}`;
const base64UrlDigest: SyntheticValue = (seed) =>
  createHash("sha256").update(seed).digest("base64url");
const hexDigest: SyntheticValue = (seed) =>
  createHash("sha256").update(seed).digest("hex");
const promotionCode: SyntheticValue = (seed) =>
  `SYNTHETIC-${hexDigest(seed).slice(0, 24).toUpperCase()}`;

type RowFixture<T extends PgTable = PgTable> = {
  /** Values for sensitive columns with format constraints, by column key. */
  readonly values?: {
    readonly [K in keyof InferInsertModel<T>]?: SyntheticValue;
  };
  /**
   * Inserts the rows the table's row references and returns a valid row
   * without its sensitive columns, in a state that admits a value in each,
   * with its primary key set. Postgres checks the values.
   */
  readonly row: (db: WorkspaceDatabaseClient) => Effect.Effect<
    {
      readonly [K in keyof InferInsertModel<T>]?: unknown;
    },
    unknown
  >;
};

const rowFixture = <T extends PgTable>(
  table: T,
  { values = {}, row }: RowFixture<NoInfer<T>>
): readonly [
  PgTable,
  {
    readonly values: ReadonlyMap<string, SyntheticValue>;
    readonly row: (
      db: WorkspaceDatabaseClient
    ) => Effect.Effect<object, unknown>;
  },
] => [
  table,
  {
    values: new Map(
      Object.entries(values).filter(
        (entry): entry is [string, SyntheticValue] => entry[1] !== undefined
      )
    ),
    row,
  },
];

const syntheticId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => Temporal.Now.instant();
const inAnHour = () => now().add({ hours: 1 });

const cliSessionRow = () => ({
  id: crypto.randomUUID(),
  clientName: "Synthetic CLI",
  cliVersion: "1.0.0",
  buildTarget: "development",
});

const oauthClient = (db: WorkspaceDatabaseClient) => {
  const clientId = syntheticId("client");
  return db
    .insert(authOauthClient)
    .values({
      id: syntheticId("oauth-client"),
      clientId,
      redirectUris: ["https://synthetic.invalid/callback"],
    })
    .pipe(Effect.as(clientId));
};

const login = (db: WorkspaceDatabaseClient) =>
  workspaceFixtures(db)
    .account("sensitive-columns")
    .pipe(Effect.map(({ accountId }) => accountId));

const heldReservation = (db: WorkspaceDatabaseClient) =>
  workspaceFixtures(db)
    .reservation({ stage: { reservation: "held" } })
    .pipe(Effect.map(({ id }) => id));

const rowFixtures = new Map([
  rowFixture(administrationActions, {
    row: (db) =>
      Effect.gen(function* () {
        const session = { ...cliSessionRow(), approvedBy: "synthetic-admin" };
        yield* db.insert(cliSessions).values({
          ...session,
          tokenHash: base64UrlDigest(session.id),
        } as never);
        return {
          id: crypto.randomUUID(),
          operation: "synthetic.operation",
          outcome: "started",
          cliSessionId: session.id,
        };
      }),
  }),
  rowFixture(administratorAssistantConnections, {
    row: () =>
      Effect.succeed({
        id: crypto.randomUUID(),
        oauthClientId: syntheticId("client"),
        clientName: "Synthetic assistant",
      }),
  }),
  rowFixture(cliAuthenticationRequests, {
    values: { codeHash: base64UrlDigest, grantToken: base64UrlDigest },
    row: () =>
      Effect.succeed({
        ...cliSessionRow(),
        challenge: base64UrlDigest(crypto.randomUUID()),
        expiresAt: inAnHour(),
        approvedAt: now(),
        approvedBy: "synthetic-admin",
        grantExpiresAt: inAnHour(),
      }),
  }),
  rowFixture(cliSessions, {
    values: { tokenHash: base64UrlDigest },
    row: () => Effect.succeed(cliSessionRow()),
  }),
  rowFixture(customerMarketingManagementTokens, {
    values: { tokenHash: hexDigest },
    row: () =>
      Effect.succeed({
        dotyposCustomerId: "synthetic-customer",
        purpose: "link",
        expiresAt: inAnHour(),
      }),
  }),
  rowFixture(discountCodes, {
    values: { code: promotionCode },
    row: (db) =>
      Effect.gen(function* () {
        const [discount] = yield* db
          .insert(discounts)
          .values({
            labels: { "en-US": "Synthetic", "cs-CZ": "Synthetic" },
            percentageBasisPoints: 1000,
          })
          .returning({ id: discounts.id });
        const promotionCodeId = syntheticId("promotion");
        yield* db.insert(promotionCodes).values({
          id: promotionCodeId,
          kind: "discount",
          code: promotionCode(promotionCodeId),
          enabled: true,
        } as never);
        return {
          id: syntheticId("discount-code"),
          enabled: true,
          promotionCodeId,
          discountId: discount!.id,
        };
      }),
  }),
  rowFixture(emailCampaignConfirmationCodes, {
    row: (db) =>
      Effect.gen(function* () {
        const [campaign] = yield* db
          .insert(emailCampaigns)
          .values({
            title: "Synthetic campaign",
            purpose: "marketing",
            templateKey: "workspace",
          })
          .returning({ id: emailCampaigns.id });
        return {
          campaignId: campaign!.id,
          contentHash: "synthetic-content",
          issuedAt: now(),
          expiresAt: inAnHour(),
        };
      }),
  }),
  rowFixture(manualInvoiceActors, {
    row: (db) =>
      Effect.gen(function* () {
        const [invoice] = yield* db
          .insert(invoices)
          .values({
            dotyposCustomerId: "synthetic-customer",
            invoiceNumber: syntheticId("invoice"),
            numberingYear: 2026,
            // Far beyond any sequence another suite issues.
            numberingSequence: 1_000_000_000 + Math.floor(Math.random() * 1e9),
            keyId: "SYNTHETIC_KEY",
            encryptedDocument: Buffer.from("synthetic"),
            issuedAt: Temporal.Instant.from("2026-06-01T12:00:00Z"),
          } as never)
          .returning({ id: invoices.id });
        return { invoiceId: invoice!.id };
      }),
  }),
  rowFixture(paymentAttempts, {
    row: (db) =>
      Effect.gen(function* () {
        return {
          id: syntheticId("payment"),
          workspaceReservationId: yield* heldReservation(db),
          provider: "nexi",
          providerOrderId: syntheticId("order"),
          state: "created",
          amountValue: 100,
          amountExponent: 2,
          currency: "CZK",
        };
      }),
  }),
  rowFixture(promotionCodes, {
    values: { code: promotionCode },
    row: () =>
      Effect.succeed({
        id: syntheticId("promotion"),
        kind: "referral",
        enabled: true,
      }),
  }),
  rowFixture(reservationAccessGrants, {
    row: (db) =>
      Effect.gen(function* () {
        return {
          id: syntheticId("grant"),
          workspaceReservationId: yield* heldReservation(db),
          deviceId: "synthetic-device",
          state: "issued",
          providerCredentialId: syntheticId("credential"),
          issuedAt: now(),
          scheduledAccessStartsAt: now(),
          accessStartsAt: now(),
          accessEndsAt: inAnHour(),
        };
      }),
  }),
  rowFixture(standaloneAccessCodeAttemptEvents, {
    row: () =>
      Effect.succeed({
        id: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
        eventKind: "started",
        source: "admin-ui",
        name: "Synthetic access",
        deviceId: "synthetic-device",
        startsAtLocal: "2026-06-01T10:00",
        endsAtLocal: "2026-06-01T12:00",
        startsAt: now(),
        endsAt: inAnHour(),
        variance: 2,
        occurredAt: now(),
      }),
  }),
  rowFixture(authAccount, {
    row: (db) =>
      Effect.gen(function* () {
        return {
          id: syntheticId("account"),
          issuer: "synthetic",
          accountId: syntheticId("provider-account"),
          providerId: "credential",
          userId: yield* login(db),
        };
      }),
  }),
  rowFixture(authOauthAccessToken, {
    row: (db) =>
      Effect.gen(function* () {
        return {
          id: syntheticId("access-token"),
          clientId: yield* oauthClient(db),
          scopes: ["openid"],
        };
      }),
  }),
  rowFixture(authOauthClient, {
    row: () =>
      Effect.succeed({
        id: syntheticId("oauth-client"),
        clientId: syntheticId("client"),
        redirectUris: ["https://synthetic.invalid/callback"],
      }),
  }),
  rowFixture(authOauthRefreshToken, {
    row: (db) =>
      Effect.gen(function* () {
        return {
          id: syntheticId("refresh-token"),
          clientId: yield* oauthClient(db),
          userId: yield* login(db),
          scopes: ["openid"],
        };
      }),
  }),
  rowFixture(authPasskey, {
    row: (db) =>
      Effect.gen(function* () {
        return {
          id: syntheticId("passkey"),
          publicKey: "synthetic-public-key",
          userId: yield* login(db),
          credentialID: syntheticId("credential"),
          counter: 0,
          deviceType: "singleDevice",
          backedUp: false,
        };
      }),
  }),
  rowFixture(authRateLimit, {
    row: () =>
      Effect.succeed({
        id: syntheticId("rate-limit"),
        count: 1,
        lastRequest: Date.now(),
      }),
  }),
  rowFixture(authSession, {
    row: (db) =>
      Effect.gen(function* () {
        return {
          id: syntheticId("session"),
          expiresAt: new Date(inAnHour().epochMilliseconds),
          userId: yield* login(db),
        };
      }),
  }),
  rowFixture(authUser, {
    row: (db) =>
      Effect.gen(function* () {
        return {
          id: yield* workspaceFixtures(db).customerAccount(),
          name: "Synthetic",
        };
      }),
  }),
  rowFixture(authVerification, {
    row: () =>
      Effect.succeed({
        id: syntheticId("verification"),
        expiresAt: new Date(inAnHour().epochMilliseconds),
      }),
  }),
]);

const primaryKey = (table: PgTable) => {
  const [compositeKey] = getTableConfig(table).primaryKeys;
  return (
    compositeKey?.columns ??
    Object.values(getTableColumns(table)).filter(({ primary }) => primary)
  );
};

const runId = crypto.randomUUID();

describe.skipIf(!testDatabase)("sensitive columns on Postgres", () => {
  test("has a row fixture for every table with a sensitive column", () => {
    const uncovered = sensitiveColumns
      .filter(({ table }) => !rowFixtures.has(table))
      .map(({ id }) => id);

    expect(uncovered).toEqual([]);
  });

  test.each(sensitiveColumns.map(({ id }, index) => [id, index] as const))(
    "censors %s in written and compared values and stores them as written",
    async (_, index) => {
      const { table, key, column } = sensitiveColumns[index]!;
      const fixture = rowFixtures.get(table)!;
      const syntheticValue = (columnKey: string, step: string) =>
        (fixture.values.get(columnKey) ?? syntheticText)(
          `${runId}-${index}-${columnKey}-${step}`
        );
      const inserted = syntheticValue(key, "insert");
      const updated = syntheticValue(key, "update");
      const conflictSet = syntheticValue(key, "conflict-set");
      const absent = syntheticValue(key, "absent");
      const otherSensitiveValues = Object.fromEntries(
        sensitiveColumns
          .filter((other) => other.table === table && other.key !== key)
          .map((other) => [other.key, syntheticValue(other.key, "row")])
      );
      const { schema = "public", name } = getTableConfig(table);
      const storedCountQuery = `select count(*)::int as count from "${schema}"."${name}" where "${column.name}" = $1`;

      const connection = await testDatabase!.pool.connect();
      try {
        await connection.query("begin");
        const storedCount = (value: string) =>
          Effect.promise(() =>
            connection.query<{ count: number }>(storedCountQuery, [value])
          ).pipe(Effect.map(({ rows }) => rows[0]!.count));

        const { logs, exit } = await Effect.runPromise(
          withHeldTransaction(connection, (db) =>
            Effect.gen(function* () {
              const row = {
                ...(yield* fixture.row(db)),
                ...otherSensitiveValues,
              };
              return yield* captureDatabaseQueryLogsWithExit(
                Effect.gen(function* () {
                  yield* db
                    .insert(table)
                    .values({ ...row, [key]: inserted } as never);
                  expect(yield* storedCount(inserted)).toBe(1);

                  yield* db
                    .update(table)
                    .set({ [key]: updated } as never)
                    .where(eq(column, inserted));
                  expect(yield* storedCount(updated)).toBe(1);

                  yield* db
                    .insert(table)
                    .values({ ...row, [key]: updated } as never)
                    .onConflictDoUpdate({
                      target: primaryKey(table),
                      set: { [key]: conflictSet } as never,
                    });
                  expect(yield* storedCount(updated)).toBe(0);
                  expect(yield* storedCount(conflictSet)).toBe(1);

                  const selected = yield* db
                    .select({ value: column })
                    .from(table)
                    .where(
                      and(
                        eq(column, conflictSet),
                        ne(column, absent),
                        inArray(column, [conflictSet, absent])
                      )
                    );
                  expect(selected).toEqual([{ value: conflictSet }]);

                  yield* db.delete(table).where(eq(column, absent));
                })
              );
            })
          )
        );

        if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
        expect(logs).toHaveLength(5);
        expectQueryLogsToOmit({
          logs,
          values: [
            inserted,
            updated,
            conflictSet,
            absent,
            ...Object.values(otherSensitiveValues),
          ],
        });
      } finally {
        await connection.query("rollback").catch(() => {});
        connection.release();
      }
    }
  );
});
