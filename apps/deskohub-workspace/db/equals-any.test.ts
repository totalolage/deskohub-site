import { describe, expect, test } from "bun:test";
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { equalsAny } from "./equals-any";

const items = pgTable("items", { id: text("id").primaryKey() });

describe("equalsAny", () => {
  test("binds any number of values as one array parameter", () => {
    const ids = Array.from({ length: 70_000 }, (_, index) => `id-${index}`);
    const query = new PgDialect().sqlToQuery(equalsAny(items.id, ids));

    expect(query.sql).toBe('"items"."id" = any($1::text[])');
    expect(query.params).toEqual([ids]);
  });
});
