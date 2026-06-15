import { sql } from "drizzle-orm";

export const quotedSqlList = (values: readonly string[]) => {
  if (values.length === 0) {
    throw new Error("SQL list must not be empty");
  }

  return sql.raw(
    values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ")
  );
};
