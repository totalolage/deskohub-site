import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzleRawTypeParsers } from "@/db/postgres-type-parsers";

/** A disposable PostgreSQL 18 cluster with no TCP listener or external database URL. */
export const startLocalPostgres = async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-postgres-test-"));
  const data = join(directory, "data");
  const bin =
    process.env.WORKSPACE_TEST_POSTGRES_BIN ?? "/usr/lib/postgresql/18/bin";
  let started = false;
  const pool = new Pool({
    host: directory,
    port: 55439,
    user: "workspace_test",
    database: "postgres",
    types: drizzleRawTypeParsers,
  });
  const stop = async () => {
    await pool.end();
    if (started) {
      execFileSync(
        join(bin, "pg_ctl"),
        ["-D", data, "-m", "immediate", "-w", "stop"],
        { stdio: "pipe" }
      );
    }
    await rm(directory, { recursive: true });
  };
  try {
    execFileSync(
      join(bin, "initdb"),
      [
        "-D",
        data,
        "-U",
        "workspace_test",
        "--auth=trust",
        "--no-locale",
        "--encoding=UTF8",
      ],
      { stdio: "pipe" }
    );
    execFileSync(
      join(bin, "pg_ctl"),
      [
        "-D",
        data,
        "-l",
        join(directory, "postgres.log"),
        "-o",
        `-h '' -k ${directory} -p 55439`,
        "-w",
        "start",
      ],
      { stdio: "pipe" }
    );
    started = true;
    // Stock PostgreSQL 18 provides uuidv7; hosted deployments use pg_uuidv7's name.
    await pool.query(
      "CREATE FUNCTION uuid_generate_v7() RETURNS uuid LANGUAGE SQL AS 'SELECT uuidv7()'"
    );
    const migrations = new URL("../../db/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).sort()) {
      const migration = await readFile(
        new URL(`${name}/migration.sql`, migrations),
        "utf8"
      );
      await pool.query(
        migration.replace('CREATE EXTENSION IF NOT EXISTS "pg_uuidv7";', "")
      );
    }
    return { pool, stop };
  } catch (error) {
    await stop();
    throw error;
  }
};
