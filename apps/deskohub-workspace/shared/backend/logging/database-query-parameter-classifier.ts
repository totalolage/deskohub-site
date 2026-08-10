import { type SQL, sql } from "drizzle-orm";

const sensitiveParameterPattern =
  /\/\*\s*deskohub:sensitive\s*\*\/\s*\$(\d+)\b/g;

export const sensitiveDatabaseParameter = <T>(value: T): SQL<T> =>
  sql<T>`/* deskohub:sensitive */ ${value}`;

export const getSensitiveDatabaseQueryParameterIndexes = (
  query: string
): ReadonlySet<number> => {
  const indexes = new Set<number>();

  for (const match of query.matchAll(sensitiveParameterPattern)) {
    const position = Number(match[1]);
    if (Number.isSafeInteger(position) && position > 0) {
      indexes.add(position - 1);
    }
  }

  return indexes;
};
