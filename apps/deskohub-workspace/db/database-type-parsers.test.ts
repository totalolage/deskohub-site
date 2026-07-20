import { describe, expect, test } from "bun:test";
import * as PgClient from "@effect/sql-pg/PgClient";
import "@/shared/polyfills/temporal";
import { makeWithDefaults } from "drizzle-orm/effect-postgres";
import { Effect, Layer } from "effect";
import {
  drizzleRawTypeOids,
  drizzleRawTypeParsers,
} from "./postgres-type-parsers";
import { workspaceReservations } from "./schema/workspace-reservations";

const makeCompileOnlyDatabase = () =>
  Effect.runPromise(
    makeWithDefaults().pipe(
      Effect.provide(Layer.succeed(PgClient.PgClient, {} as PgClient.PgClient))
    )
  );

describe("Effect Postgres type parsing", () => {
  test("the pool parsers preserve Drizzle codec values as raw text", () => {
    const source = "2026-07-20 12:34:56.123456+00";

    for (const oid of drizzleRawTypeOids) {
      expect(drizzleRawTypeParsers.getTypeParser(oid, "text")(source)).toBe(
        source
      );
    }
  });

  test("the instant column maps PostgreSQL text without losing microseconds", () => {
    const parsed = workspaceReservations.createdAt.mapFromDriverValue(
      "2026-07-20 12:34:56.123456+00"
    );

    expect(parsed).toBeInstanceOf(Temporal.Instant);
    expect(parsed.toString()).toBe("2026-07-20T12:34:56.123456Z");
    expect(
      workspaceReservations.createdAt.mapToDriverValue(
        Temporal.Instant.from("2026-07-20T12:34:56.123456789Z")
      )
    ).toBe("2026-07-20T12:34:56.123456Z");
    expect(workspaceReservations.createdAt.getSQLType()).toBe(
      "timestamp with time zone"
    );
    expect(() =>
      workspaceReservations.createdAt.mapFromDriverValue("not-an-instant")
    ).toThrow();
  });

  test("Drizzle Effect casts instant selections to text for the column codec", async () => {
    const db = await makeCompileOnlyDatabase();
    const query = db
      .select({
        paidAt: workspaceReservations.paidAt,
        createdAt: workspaceReservations.createdAt,
      })
      .from(workspaceReservations)
      .toSQL();

    expect(query.sql).toContain('"paid_at"::text');
    expect(query.sql).toContain('"created_at"::text');
  });
});
