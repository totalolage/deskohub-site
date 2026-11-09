import { mkdtemp, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createScratchPostgresDatabase } from "@/shared/testing/postgres-scratch-database.test-utils";

/** The Workspace Drizzle migrations. */
export const workspaceMigrationsFolder = fileURLToPath(
  new URL("./migrations", import.meta.url)
);

/**
 * Links every migration that precedes `migration` into a scratch folder, so
 * a database can be brought to the state production is in before it.
 */
export const linkMigrationsBefore = async (migration: string) => {
  const folder = await mkdtemp(join(tmpdir(), "workspace-migrations-"));
  const names = await readdir(workspaceMigrationsFolder);
  for (const name of names.filter((entry) => entry < migration)) {
    await symlink(join(workspaceMigrationsFolder, name), join(folder, name));
  }
  return folder;
};

/**
 * How many migrations `linkMigrationsBefore` left out: the named migration
 * and every later one, which `migrate` applies together afterwards.
 */
export const countMigrationsFrom = async (migration: string) =>
  (await readdir(workspaceMigrationsFolder)).filter(
    (entry) => entry >= migration
  ).length;

/**
 * Creates a disposable sibling database next to the configured test
 * database, runs the callback against it, and always drops it.
 */
export const withScratchDatabase = async (
  databaseUrl: string,
  namePrefix: string,
  run: (pool: Pool) => Promise<void>
) => {
  const scratch = await createScratchPostgresDatabase(databaseUrl, namePrefix);
  const pool = new Pool({ connectionString: scratch.url, max: 2 });
  try {
    await run(pool);
  } finally {
    await pool.end();
    await scratch.drop();
  }
};
