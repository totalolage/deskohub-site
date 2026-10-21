import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { equalsAny } from "./equals-any";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const items = pgTable("equals_any_items", {
  id: text("id").primaryKey(),
  rank: integer("rank").notNull(),
});

describe.skipIf(!testDatabase)("equalsAny on Postgres", () => {
  if (!testDatabase) return;
  const { db, pool } = testDatabase;

  beforeAll(async () => {
    await pool.query(`
      create table equals_any_items (id text primary key, rank integer not null);
      insert into equals_any_items values ('a', 1), ('b', 2), ('c', 3);
    `);
  });

  afterAll(async () => {
    await pool.query("drop table equals_any_items;");
  });

  test("matches rows from a list longer than the parameter limit", async () => {
    const ids = [
      ...Array.from({ length: 70_000 }, (_, index) => `missing-${index}`),
      "a",
      "c",
    ];
    const rows = await Effect.runPromise(
      db
        .select({ id: items.id })
        .from(items)
        .where(equalsAny(items.id, ids))
        .orderBy(items.rank)
    );

    expect(rows).toEqual([{ id: "a" }, { id: "c" }]);
  });

  test("matches nothing for an empty list", async () => {
    const rows = await Effect.runPromise(
      db.select({ id: items.id }).from(items).where(equalsAny(items.id, []))
    );

    expect(rows).toEqual([]);
  });
});
