import { readdir, readFile } from "node:fs/promises";
import type { Client } from "pg";

const migrationsDirectory = new URL("../../db/migrations/", import.meta.url);

export const applyCommittedWorkspaceMigrations = async (client: Client) => {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrationDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directory of migrationDirectories) {
    const migration = await readFile(
      new URL(`${directory}/migration.sql`, migrationsDirectory),
      "utf8"
    );
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await client.query(statement);
    }
  }
};
