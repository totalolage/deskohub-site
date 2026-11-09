import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  AdministrationCampaignAudience,
  type AdministrationReservationStatusFilterType,
  type AudienceConditionOf,
} from "@deskohub/workspace-admin-api";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Schema } from "effect";
import type { Pool, PoolClient } from "pg";
import {
  type AudienceFilter,
  audienceFilterSchema,
} from "@/features/email-campaigns/audience-filter";
import {
  linkMigrationsBefore,
  withScratchDatabase,
  workspaceMigrationsFolder,
} from "../migration-scratch-database.test-utils";

const MIGRATION_DIR = "20261015125401_audience_attribute_conditions";

const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

const migrationStatements = async () =>
  (
    await readFile(
      join(workspaceMigrationsFolder, MIGRATION_DIR, "migration.sql"),
      "utf8"
    )
  ).split("--> statement-breakpoint");

/** Runs the migration's SQL again and returns each statement's row count. */
const rerunMigration = async (client: Pool | PoolClient) => {
  const counts: (number | null)[] = [];
  for (const statement of await migrationStatements()) {
    counts.push((await client.query(statement)).rowCount);
  }
  return counts;
};

/** The condition shapes audiences were stored with before the catalogue. */
type LegacyReservationFields = {
  readonly presence: "has" | "hasNot";
  readonly dateBasis: "visit" | "booking";
  readonly from?: string;
  readonly to?: string;
  readonly status?: AdministrationReservationStatusFilterType;
};
type LegacyCondition =
  | ({ readonly _tag: "Reservation" } & LegacyReservationFields)
  | { readonly _tag: "Locale"; readonly locales: readonly string[] }
  | { readonly _tag: "Account"; readonly hasAccount: boolean }
  | { readonly _tag: "DotyposTag"; readonly tag: string }
  | { readonly _tag: "DiscountGroup"; readonly discountGroupId: string };

/** A stored filter tree: legacy conditions, new ones, or a mix. */
type StoredFilter =
  | LegacyCondition
  | AudienceFilter
  | { readonly _tag: "Mystery" }
  | {
      readonly _tag: "Group";
      readonly operator: "and" | "or";
      readonly filters: readonly StoredFilter[];
    };

type StoredAudience = Omit<
  typeof AdministrationCampaignAudience.Encoded,
  "filter"
> & {
  readonly filter: StoredFilter;
};

type StoredCliMutation =
  | {
      readonly kind: "campaign-audience-create";
      readonly audience: {
        readonly title: string;
        readonly filter: StoredFilter;
      };
    }
  | { readonly kind: "campaign-duplicate"; readonly campaignId: string };

type StoredCliResult = StoredAudience | { readonly id: string } | null;

const reservation = (fields: LegacyReservationFields): LegacyCondition => ({
  _tag: "Reservation",
  ...fields,
});

const reservationCount = (
  operator: "gt" | "eq",
  params: AudienceConditionOf<"reservationCount">["params"]
): AudienceFilter => ({
  attribute: "reservationCount",
  _tag: "Condition",
  params,
  operator,
  value: 0,
});

const alreadyMigrated: AudienceFilter = {
  attribute: "campaignEmailCount",
  _tag: "Condition",
  params: {
    purpose: "marketing",
    period: { _tag: "Last", count: 10, unit: "day" },
  },
  operator: "eq",
  value: 0,
};

/** Every legacy node, every period bound for both bases, with its rewrite. */
const conditionCases: readonly {
  readonly legacy: StoredFilter;
  readonly migrated: AudienceFilter;
}[] = [
  {
    legacy: reservation({
      presence: "has",
      dateBasis: "visit",
      from: "2026-01-01",
      to: "2026-01-31",
      status: "complete",
    }),
    migrated: reservationCount("gt", {
      dateBasis: "visit",
      period: { _tag: "Range", from: "2026-01-01", to: "2026-01-31" },
      status: "complete",
    }),
  },
  {
    legacy: reservation({
      presence: "hasNot",
      dateBasis: "visit",
      from: "2026-02-01",
    }),
    migrated: reservationCount("eq", {
      dateBasis: "visit",
      period: { _tag: "Onward", date: "2026-02-01" },
    }),
  },
  {
    legacy: reservation({
      presence: "has",
      dateBasis: "visit",
      to: "2026-03-01",
      status: "cancelled",
    }),
    migrated: reservationCount("gt", {
      dateBasis: "visit",
      period: { _tag: "Until", date: "2026-03-01" },
      status: "cancelled",
    }),
  },
  {
    legacy: reservation({ presence: "hasNot", dateBasis: "visit" }),
    migrated: reservationCount("eq", {
      dateBasis: "visit",
      period: { _tag: "AnyTime" },
    }),
  },
  {
    legacy: reservation({
      presence: "hasNot",
      dateBasis: "booking",
      from: "2026-04-01",
      to: "2026-04-30",
    }),
    migrated: reservationCount("eq", {
      dateBasis: "booking",
      period: { _tag: "Range", from: "2026-04-01", to: "2026-04-30" },
    }),
  },
  {
    legacy: reservation({
      presence: "has",
      dateBasis: "booking",
      from: "2026-05-01",
      status: "needs_refund",
    }),
    migrated: reservationCount("gt", {
      dateBasis: "booking",
      period: { _tag: "Onward", date: "2026-05-01" },
      status: "needs_refund",
    }),
  },
  {
    legacy: reservation({
      presence: "has",
      dateBasis: "booking",
      to: "2026-06-01",
    }),
    migrated: reservationCount("gt", {
      dateBasis: "booking",
      period: { _tag: "Until", date: "2026-06-01" },
    }),
  },
  {
    legacy: reservation({
      presence: "hasNot",
      dateBasis: "booking",
      status: "in_progress",
    }),
    migrated: reservationCount("eq", {
      dateBasis: "booking",
      period: { _tag: "AnyTime" },
      status: "in_progress",
    }),
  },
  {
    legacy: { _tag: "Locale", locales: ["cs-CZ", "en-US"] },
    migrated: {
      attribute: "locale",
      _tag: "Condition",
      operator: "anyOf",
      value: ["cs-CZ", "en-US"],
    },
  },
  {
    legacy: { _tag: "Account", hasAccount: true },
    migrated: {
      attribute: "hasAccount",
      _tag: "Condition",
      operator: "is",
      value: true,
    },
  },
  {
    legacy: { _tag: "Account", hasAccount: false },
    migrated: {
      attribute: "hasAccount",
      _tag: "Condition",
      operator: "is",
      value: false,
    },
  },
  {
    legacy: { _tag: "DotyposTag", tag: "regular" },
    migrated: {
      attribute: "dotyposTags",
      _tag: "Condition",
      operator: "anyOf",
      value: ["regular"],
    },
  },
  {
    legacy: { _tag: "DiscountGroup", discountGroupId: "42" },
    migrated: {
      attribute: "discountGroup",
      _tag: "Condition",
      operator: "anyOf",
      value: ["42"],
    },
  },
  { legacy: alreadyMigrated, migrated: alreadyMigrated },
];

const group = <Filter extends StoredFilter>(
  operator: "and" | "or",
  filters: readonly Filter[]
) => ({ _tag: "Group" as const, operator, filters });

const filterCases = [
  ...conditionCases.map(({ legacy, migrated }) => ({
    legacy: group("and", [legacy]),
    migrated: group("and", [migrated]),
  })),
  { legacy: group("and", []), migrated: group("and", []) },
  {
    legacy: group("or", [
      group(
        "and",
        conditionCases.map(({ legacy }) => legacy)
      ),
      group("or", []),
      conditionCases[1]!.legacy,
    ]),
    migrated: group("or", [
      group(
        "and",
        conditionCases.map(({ migrated }) => migrated)
      ),
      group("or", []),
      conditionCases[1]!.migrated,
    ]),
  },
];

const nestedCase = filterCases.at(-1)!;

const insertAudience = async (pool: Pool, filter: StoredFilter) =>
  (
    await pool.query<{ id: string }>(
      `insert into email_campaign_audiences (title, filter) values ('Audience', $1) returning id`,
      [JSON.stringify(filter)]
    )
  ).rows[0]!.id;

const insertSend = async (pool: Pool, filter: StoredFilter) => {
  const campaign = await pool.query<{ id: string }>(
    `insert into email_campaigns (title, purpose, template_key) values ('Campaign', 'marketing', 'announcement') returning id`
  );
  return (
    await pool.query<{ id: string }>(
      `insert into email_campaign_sends (campaign_id, audience_filter, content_hash) values ($1, $2, 'hash') returning id`,
      [campaign.rows[0]!.id, JSON.stringify(filter)]
    )
  ).rows[0]!.id;
};

const insertCliSession = async (pool: Pool) =>
  (
    await pool.query<{ id: string }>(
      `insert into cli_sessions (token_hash, client_name, cli_version, build_target, approved_by)
       values ($1, 'dhw', '1.0.0', 'development', 'admin') returning id`,
      ["a".repeat(43)]
    )
  ).rows[0]!.id;

const insertCliMutation = async (
  pool: Pool,
  sessionId: string,
  mutation: StoredCliMutation,
  result: StoredCliResult
) => {
  const requestId = crypto.randomUUID();
  await pool.query(
    `insert into cli_mutation_requests (session_id, request_id, mutation, result, completed_at)
     values ($1, $2, $3, $4, case when $4::jsonb is null then null else now() end)`,
    [
      sessionId,
      requestId,
      JSON.stringify(mutation),
      result === null ? null : JSON.stringify(result),
    ]
  );
  return requestId;
};

const audienceFilters = async (pool: Pool, ids: readonly string[]) => {
  const rows = (
    await pool.query<{ id: string; filter: unknown }>(
      `select id, filter from email_campaign_audiences where id = any($1)`,
      [ids]
    )
  ).rows;
  return ids.map((id) => rows.find((row) => row.id === id)!.filter);
};

const sendFilter = async (pool: Pool, id: string) =>
  (
    await pool.query<{ audience_filter: unknown }>(
      `select audience_filter from email_campaign_sends where id = $1`,
      [id]
    )
  ).rows[0]!.audience_filter;

const cliMutation = async (pool: Pool, requestId: string) =>
  (
    await pool.query<{ mutation: unknown; result: unknown }>(
      `select mutation, result from cli_mutation_requests where request_id = $1`,
      [requestId]
    )
  ).rows[0]!;

const audienceResult = (filter: StoredFilter): StoredAudience => ({
  id: crypto.randomUUID(),
  title: "Audience",
  filter,
  archivedAt: null,
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
});

describe.skipIf(!testDatabaseUrl)(
  "audience attribute conditions migration",
  () => {
    test(
      "rewrites stored legacy audience filters to attribute conditions once",
      async () => {
        const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
        try {
          await withScratchDatabase(
            testDatabaseUrl!,
            "audience_filter_migration",
            async (pool) => {
              await migrate(drizzle({ client: pool }), {
                migrationsFolder: earlierMigrations,
              });
              const audienceIds: string[] = [];
              for (const { legacy } of filterCases) {
                audienceIds.push(await insertAudience(pool, legacy));
              }
              const sendId = await insertSend(pool, nestedCase.legacy);
              const sessionId = await insertCliSession(pool);
              const createdAudience = audienceResult(nestedCase.legacy);
              const completedCreate = await insertCliMutation(
                pool,
                sessionId,
                {
                  kind: "campaign-audience-create",
                  audience: { title: "Audience", filter: nestedCase.legacy },
                },
                createdAudience
              );
              const pendingCreate = await insertCliMutation(
                pool,
                sessionId,
                {
                  kind: "campaign-audience-create",
                  audience: {
                    title: "Pending",
                    filter: conditionCases[0]!.legacy,
                  },
                },
                null
              );
              const duplicate = {
                mutation: {
                  kind: "campaign-duplicate",
                  campaignId: crypto.randomUUID(),
                },
                result: { id: crypto.randomUUID() },
              } as const;
              const unrelated = await insertCliMutation(
                pool,
                sessionId,
                duplicate.mutation,
                duplicate.result
              );

              await migrate(drizzle({ client: pool }), {
                migrationsFolder: workspaceMigrationsFolder,
              });

              const migratedFilters = await audienceFilters(pool, audienceIds);
              expect(migratedFilters).toEqual(
                filterCases.map(({ migrated }) => migrated)
              );
              for (const filter of migratedFilters) {
                expect(() =>
                  Schema.decodeUnknownSync(audienceFilterSchema)(filter)
                ).not.toThrow();
              }
              expect(await sendFilter(pool, sendId)).toEqual(
                nestedCase.migrated
              );
              expect(await cliMutation(pool, completedCreate)).toEqual({
                mutation: {
                  kind: "campaign-audience-create",
                  audience: { title: "Audience", filter: nestedCase.migrated },
                },
                result: { ...createdAudience, filter: nestedCase.migrated },
              });
              const replayed = (await cliMutation(pool, completedCreate))
                .result;
              expect(() =>
                Schema.decodeUnknownSync(AdministrationCampaignAudience)(
                  replayed
                )
              ).not.toThrow();
              expect(await cliMutation(pool, pendingCreate)).toEqual({
                mutation: {
                  kind: "campaign-audience-create",
                  audience: {
                    title: "Pending",
                    filter: conditionCases[0]!.migrated,
                  },
                },
                result: null,
              });
              expect(await cliMutation(pool, unrelated)).toEqual(duplicate);

              const rowCounts = await rerunMigration(pool);
              expect(rowCounts.slice(1, -1)).toEqual([0, 0, 0]);
              expect(await audienceFilters(pool, audienceIds)).toEqual(
                migratedFilters
              );
            }
          );
        } finally {
          await rm(earlierMigrations, { recursive: true, force: true });
        }
      },
      { timeout: 60000 }
    );

    test(
      "aborts on a filter node it does not know",
      async () => {
        await withScratchDatabase(
          testDatabaseUrl!,
          "audience_filter_migration",
          async (pool) => {
            await migrate(drizzle({ client: pool }), {
              migrationsFolder: workspaceMigrationsFolder,
            });
            const id = await insertAudience(
              pool,
              group("and", [{ _tag: "Mystery" }])
            );

            const client = await pool.connect();
            try {
              await client.query("begin");
              await expect(rerunMigration(client)).rejects.toThrow(
                "Unknown audience filter node"
              );
              await client.query("rollback");
            } finally {
              client.release();
            }

            expect(await audienceFilters(pool, [id])).toEqual([
              group("and", [{ _tag: "Mystery" }]),
            ]);
          }
        );
      },
      { timeout: 60000 }
    );
  }
);
