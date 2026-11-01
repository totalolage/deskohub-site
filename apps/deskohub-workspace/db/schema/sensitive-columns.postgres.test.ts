/**
 * Drives every sensitive column through the real query logger against
 * Postgres: an insert, an update, an `onConflictDoUpdate` set, and `eq`,
 * `ne`, and `inArray` predicates. The log must never carry a written or
 * compared value. Postgres must store permitted writes unchanged and reject
 * immutable writes without changing the stored value.
 *
 * Each table with a sensitive column needs a row fixture here, so a new
 * sensitive table fails until it has one. A new sensitive column on a table
 * that has one is covered at once; when the fixture's row breaks a constraint
 * on the new column, extend the fixture.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { EmailValueName } from "@deskohub/workspace-admin-api";
import {
  and,
  eq,
  getTableColumns,
  type InferInsertModel,
  inArray,
  ne,
} from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { Cause, Effect, Exit, Predicate } from "effect";
import type { PoolClient } from "pg";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { seedCampaignSend } from "@/features/email-campaigns/backend/email-campaigns.test-utils";
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
  emailCampaignSends,
  emailCampaigns,
  emailDiscountIssuances,
  emailPreparations,
  emails,
  emailValueSnapshots,
  emailVersions,
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
const syntheticJson: SyntheticValue = (seed) =>
  JSON.stringify({ value: syntheticText(seed) });

type RowFixture<T extends PgTable = PgTable> = {
  readonly immutable?: boolean;
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
  { values = {}, row, immutable = false }: RowFixture<NoInfer<T>>
): readonly [
  PgTable,
  {
    readonly values: ReadonlyMap<string, SyntheticValue>;
    readonly immutable: boolean;
    readonly row: (
      db: WorkspaceDatabaseClient
    ) => Effect.Effect<object, unknown>;
  },
] => [
  table,
  {
    immutable,
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

const emailValueRow = (db: WorkspaceDatabaseClient) =>
  Effect.gen(function* () {
    const valueName = EmailValueName.make("synthetic");
    const [email] = yield* db
      .insert(emails)
      .values({ title: "Synthetic email" })
      .returning({ id: emails.id });
    const [version] = yield* db
      .insert(emailVersions)
      .values({
        emailId: email!.id,
        versionNumber: 1,
        requiredValueNames: [valueName],
        document: {
          purpose: "marketing",
          templateKey: "workspace",
          structure: [],
          translations: {},
          values: [],
        },
      })
      .returning({ id: emailVersions.id });
    const dotyposCustomerId = DotyposCustomerIdSchema.make(
      syntheticId("customer")
    );
    const { sendId } = yield* Effect.promise(() =>
      seedCampaignSend(db, {
        purpose: "marketing",
        recipients: [{ dotyposCustomerId }],
      })
    );
    yield* db
      .update(emailCampaignSends)
      .set({ frozenEmailVersionId: version!.id })
      .where(eq(emailCampaignSends.id, sendId));
    const [preparation] = yield* db
      .insert(emailPreparations)
      .values({
        sendId,
        dotyposCustomerId,
        emailVersionId: version!.id,
        locale: "cs-CZ",
      })
      .returning({ id: emailPreparations.id });
    return { preparationId: preparation!.id, valueName };
  });

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
  rowFixture(emailValueSnapshots, {
    immutable: true,
    values: { value: syntheticJson },
    row: emailValueRow,
  }),
  rowFixture(emailDiscountIssuances, {
    row: (db) =>
      emailValueRow(db).pipe(
        Effect.map((row) => ({
          ...row,
          recoveryIdentity: `email:${row.preparationId}:${row.valueName}`,
        }))
      ),
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

const expectWriteRefused = <A, E>(
  connection: PoolClient,
  write: Effect.Effect<A, E>,
  message: string
) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => connection.query("savepoint refused_write"));
    const exit = yield* Effect.exit(write);
    yield* Effect.promise(() =>
      connection.query("rollback to savepoint refused_write")
    );
    yield* Effect.promise(() =>
      connection.query("release savepoint refused_write")
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      let error = Cause.squash(exit.cause);
      while (Cause.isCause(error) || (error instanceof Error && error.cause)) {
        if (Cause.isCause(error)) error = Cause.squash(error);
        else if (error instanceof Error) error = error.cause;
      }
      expect(error).toMatchObject({ code: "23514", message });
    }
  });

const serializeSensitiveValue = (value: string | Temporal.Instant) =>
  Predicate.isString(value)
    ? value
    : value.toString({ smallestUnit: "microsecond" });

const testIssuanceSensitiveColumn = async (index: number) => {
  const { column, key } = sensitiveColumns[index]!;
  if (key !== "parameters" && key !== "code" && key !== "expiresAt") {
    throw new Error(`Add issuance logging coverage for ${key}`);
  }
  const expiry = Temporal.Instant.from("2037-01-01T12:00:00.123456Z");
  const values = (step: number) => ({
    parameters: JSON.stringify({
      marker: syntheticText(`${runId}-${index}-${step}`),
      expiresAt: expiry.toString(),
    }),
    code: syntheticText(`${runId}-${index}-code-${step}`),
    expiresAt: expiry.add({ seconds: step }),
  });
  const inserted = values(0);
  const updated = values(1);
  const conflictSet = values(2);
  const absent = values(3);
  const frozenMessage =
    key === "parameters"
      ? "email issuance identity and parameters are frozen"
      : "issued result is frozen";
  const changes = (value: ReturnType<typeof values>) =>
    key === "parameters"
      ? { parameters: value.parameters }
      : { code: value.code, expiresAt: value.expiresAt };
  const connection = await testDatabase!.pool.connect();
  try {
    await connection.query("begin");
    const storedCount = (value: string | Temporal.Instant) =>
      Effect.promise(() =>
        connection.query<{ count: number }>(
          `select count(*)::int as count from email_discount_issuances where "${column.name}" = $1`,
          [serializeSensitiveValue(value)]
        )
      ).pipe(Effect.map(({ rows }) => rows[0]!.count));
    const { logs, exit } = await Effect.runPromise(
      withHeldTransaction(connection, (db) =>
        Effect.gen(function* () {
          const reservation = {
            ...(yield* rowFixtures.get(emailDiscountIssuances)!.row(db)),
            parameters: inserted.parameters,
          };
          return yield* captureDatabaseQueryLogsWithExit(
            Effect.gen(function* () {
              // Result columns bind real values even though INSERT must refuse them.
              yield* expectWriteRefused(
                connection,
                db.insert(emailDiscountIssuances).values({
                  ...reservation,
                  code: inserted.code,
                  expiresAt: inserted.expiresAt,
                } as never),
                "invalid email issuance reservation"
              );
              yield* db
                .insert(emailDiscountIssuances)
                .values(reservation as never);
              yield* db
                .update(emailDiscountIssuances)
                .set({ state: "issuing" })
                .where(
                  eq(emailDiscountIssuances.parameters, inserted.parameters)
                );
              yield* db
                .update(emailDiscountIssuances)
                .set({
                  state: "issued",
                  code: inserted.code,
                  expiresAt: inserted.expiresAt,
                })
                .where(
                  eq(emailDiscountIssuances.parameters, inserted.parameters)
                );
              expect(yield* storedCount(inserted[key])).toBe(1);

              yield* expectWriteRefused(
                connection,
                db
                  .update(emailDiscountIssuances)
                  .set(changes(updated))
                  .where(eq(column, inserted[key])),
                frozenMessage
              );
              // A reservation-shaped candidate reaches the conflict UPDATE guard.
              yield* expectWriteRefused(
                connection,
                db
                  .insert(emailDiscountIssuances)
                  .values(reservation as never)
                  .onConflictDoUpdate({
                    target: primaryKey(emailDiscountIssuances),
                    set: changes(conflictSet),
                  }),
                frozenMessage
              );
              expect(yield* storedCount(inserted[key])).toBe(1);
              expect(yield* storedCount(updated[key])).toBe(0);
              expect(yield* storedCount(conflictSet[key])).toBe(0);

              const [selected] = yield* db
                .select({
                  parameters: emailDiscountIssuances.parameters,
                  code: emailDiscountIssuances.code,
                  expiresAt: emailDiscountIssuances.expiresAt,
                })
                .from(emailDiscountIssuances)
                .where(
                  and(
                    eq(column, inserted[key]),
                    ne(column, absent[key]),
                    inArray(column, [inserted[key], absent[key]])
                  )
                );
              expect(selected?.parameters).toBe(inserted.parameters);
              expect(selected?.code).toBe(inserted.code);
              expect(selected?.expiresAt).toBeInstanceOf(Temporal.Instant);
              expect(selected?.expiresAt?.equals(inserted.expiresAt)).toBe(
                true
              );
              yield* expectWriteRefused(
                connection,
                db
                  .delete(emailDiscountIssuances)
                  .where(eq(column, inserted[key])),
                "email history is immutable"
              );
              expect(yield* storedCount(inserted[key])).toBe(1);
            })
          );
        })
      )
    );
    if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
    expect(logs).toHaveLength(8);
    expectQueryLogsToOmit({
      logs,
      values: [
        ...[inserted, updated, conflictSet, absent].flatMap((value) =>
          Object.values(value).map(serializeSensitiveValue)
        ),
        `${runId}-${index}-`,
      ],
    });
  } finally {
    await connection.query("rollback").catch(() => {});
    connection.release();
  }
};

describe.skipIf(!testDatabase)("sensitive columns on Postgres", () => {
  test("has a row fixture for every table with a sensitive column", () => {
    const uncovered = sensitiveColumns
      .filter(({ table }) => !rowFixtures.has(table))
      .map(({ id }) => id);

    expect(uncovered).toEqual([]);
  });

  test.each(sensitiveColumns.map(({ id }, index) => [id, index] as const))(
    "censors %s in writes and predicates, preserving permitted values",
    async (_, index) => {
      const { table, key, column } = sensitiveColumns[index]!;
      if (table === emailDiscountIssuances) {
        await testIssuanceSensitiveColumn(index);
        return;
      }
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

                  const update = db
                    .update(table)
                    .set({ [key]: updated } as never)
                    .where(eq(column, inserted));
                  const conflict = db
                    .insert(table)
                    .values({ ...row, [key]: updated } as never)
                    .onConflictDoUpdate({
                      target: primaryKey(table),
                      set: { [key]: conflictSet } as never,
                    });
                  if (fixture.immutable) {
                    yield* expectWriteRefused(
                      connection,
                      update,
                      "email history is immutable"
                    );
                    yield* expectWriteRefused(
                      connection,
                      conflict,
                      "email history is immutable"
                    );
                    expect(yield* storedCount(inserted)).toBe(1);
                    expect(yield* storedCount(updated)).toBe(0);
                    expect(yield* storedCount(conflictSet)).toBe(0);
                  } else {
                    yield* update;
                    expect(yield* storedCount(updated)).toBe(1);
                    yield* conflict;
                    expect(yield* storedCount(updated)).toBe(0);
                    expect(yield* storedCount(conflictSet)).toBe(1);
                  }

                  const stored = fixture.immutable ? inserted : conflictSet;

                  const selected = yield* db
                    .select({ value: column })
                    .from(table)
                    .where(
                      and(
                        eq(column, stored),
                        ne(column, absent),
                        inArray(column, [stored, absent])
                      )
                    );
                  expect(selected).toEqual([{ value: stored }]);

                  if (fixture.immutable) {
                    yield* expectWriteRefused(
                      connection,
                      db.delete(table).where(eq(column, stored)),
                      "email history is immutable"
                    );
                    expect(yield* storedCount(stored)).toBe(1);
                  } else {
                    yield* db.delete(table).where(eq(column, absent));
                  }
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
            `${runId}-${index}-`,
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
