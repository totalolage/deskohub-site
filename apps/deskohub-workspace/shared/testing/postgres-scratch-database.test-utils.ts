import { Pool } from "pg";

/** Postgres truncates longer identifiers, which would cut into the suffix. */
const maxIdentifierLength = 63;

/**
 * Creates an empty sibling database next to the one at `databaseUrl`.
 * `drop` removes it, closing any connections still open to it.
 */
export const createScratchPostgresDatabase = async (
  databaseUrl: string,
  namePrefix: string
) => {
  if (!/^[a-z][a-z0-9_]*$/.test(namePrefix)) {
    throw new Error(
      `Scratch database prefix "${namePrefix}" must be a lowercase identifier.`
    );
  }
  const suffix = `_${crypto.randomUUID().replaceAll("-", "")}`;
  const name = `${namePrefix.slice(0, maxIdentifierLength - suffix.length)}${suffix}`;
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
