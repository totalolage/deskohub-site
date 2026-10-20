import { Pool } from "pg";

/**
 * Creates an empty sibling database next to the one at `databaseUrl`.
 * `drop` removes it, closing any connections still open to it.
 */
export const createScratchPostgresDatabase = async (
  databaseUrl: string,
  namePrefix: string
) => {
  const name = `${namePrefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  const administer = async (statement: string) => {
    const admin = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await admin.query(statement);
    } finally {
      await admin.end();
    }
  };
  await administer(`create database "${name}"`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: () => administer(`drop database if exists "${name}" with (force)`),
  };
};
