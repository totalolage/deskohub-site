import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { PgDialect, pgTable } from "drizzle-orm/pg-core";
import { getSensitiveDatabaseQueryParameterIndexes } from "@/shared/backend/logging/database-query-parameter-classifier";
import { sensitiveInstant } from "./sensitive-instant";

test("sensitive instants keep timestamp precision and mark the actual bound parameter", () => {
  const table = pgTable("synthetic_sensitive_instant", {
    expiresAt: sensitiveInstant("expires_at"),
  });
  const value = Temporal.Instant.from("2026-11-01T12:00:00.123456789Z");
  const encoded = table.expiresAt.mapToDriverValue(value);
  const query = new PgDialect().sqlToQuery(sql`${encoded}`);
  expect(query.params).toEqual(["2026-11-01T12:00:00.123456Z"]);
  expect(getSensitiveDatabaseQueryParameterIndexes(query.sql)).toEqual(
    new Set([0])
  );
  expect(
    table.expiresAt.mapFromDriverValue("2026-11-01T12:00:00.123456Z").toString()
  ).toBe("2026-11-01T12:00:00.123456Z");
});
