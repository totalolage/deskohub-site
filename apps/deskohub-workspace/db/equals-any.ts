import { type SQL, sql } from "drizzle-orm";
import type { PgText } from "drizzle-orm/pg-core";

/**
 * Matches a text column against a list bound as one array parameter. Drizzle's
 * `inArray` binds one parameter per value, so a long list exceeds Postgres's
 * limit of 65,535 parameters per statement. The values skip the column's
 * encoder, which is why only plain text columns qualify.
 */
export const equalsAny = <TColumn extends PgText>(
  column: TColumn,
  values: readonly TColumn["_"]["data"][]
): SQL => sql`${column} = any(${sql.param([...values])}::text[])`;
