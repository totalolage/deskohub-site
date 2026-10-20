import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const coordinationMigrationsDirectory = fileURLToPath(
  new URL("./migrations", import.meta.url)
);

/** Every coordination migration statement, in the order drizzle applies them. */
export const coordinationMigrationStatements = async (): Promise<string[]> => {
  const migrations = (await readdir(coordinationMigrationsDirectory)).sort();
  const statements: string[] = [];
  for (const migration of migrations) {
    const text = await Bun.file(
      `${coordinationMigrationsDirectory}/${migration}/migration.sql`
    ).text();
    statements.push(
      ...text
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean)
    );
  }
  return statements;
};
