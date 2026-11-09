import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { findViolatedConstraint } from "./sql-constraint";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("findViolatedConstraint on Postgres", () => {
  if (!testDatabase) return;
  const { db, pool } = testDatabase;

  beforeAll(async () => {
    await pool.query(`
      create table sql_constraint_parents (id integer primary key);
      create table sql_constraint_children (
        id integer primary key,
        parent_id integer constraint sql_constraint_children_parent_fk
          references sql_constraint_parents (id)
      );
      insert into sql_constraint_parents values (1);
    `);
  });

  afterAll(async () => {
    await pool.query(
      "drop table sql_constraint_children; drop table sql_constraint_parents;"
    );
  });

  const violatedConstraint = <
    A,
    E extends Parameters<typeof findViolatedConstraint>[0],
  >(
    statement: Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      statement.pipe(Effect.flip, Effect.map(findViolatedConstraint))
    );

  const duplicateParent = sql`insert into sql_constraint_parents values (1)`;
  const orphanChild = sql`insert into sql_constraint_children values (1, 404)`;

  test("names a violated unique constraint", async () => {
    expect(await violatedConstraint(db.execute(duplicateParent))).toEqual(
      Option.some("sql_constraint_parents_pkey")
    );
    expect(
      await violatedConstraint(
        db.transaction((tx) => tx.execute(duplicateParent))
      )
    ).toEqual(Option.some("sql_constraint_parents_pkey"));
  });

  test("names a violated foreign key", async () => {
    expect(await violatedConstraint(db.execute(orphanChild))).toEqual(
      Option.some("sql_constraint_children_parent_fk")
    );
    expect(
      await violatedConstraint(db.transaction((tx) => tx.execute(orphanChild)))
    ).toEqual(Option.some("sql_constraint_children_parent_fk"));
  });

  test("finds no constraint when a statement fails otherwise", async () => {
    expect(
      await violatedConstraint(
        db.execute(sql`select * from sql_constraint_missing`)
      )
    ).toEqual(Option.none());
  });
});
