import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * References the row proposed for insertion inside `ON CONFLICT DO UPDATE`,
 * so one multi-row upsert can update every conflicting row from its own
 * values instead of issuing a statement per row.
 */
export const excludedColumn = <TColumn extends AnyPgColumn>(
  column: TColumn
): SQL<TColumn["_"]["data"]> =>
  sql<TColumn["_"]["data"]>`excluded.${sql.identifier(column.name)}`;
