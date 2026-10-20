import { getColumnTable, getTableName, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * References a column by its table-qualified name. Drizzle drops table names
 * from the select list of a single-table query, which would rebind a
 * correlated subquery's reference to the outer row onto the subquery's own
 * table when both tables share the column name.
 */
export const qualifiedColumn = <TColumn extends AnyPgColumn>(
  column: TColumn
): SQL<TColumn["_"]["data"]> =>
  sql<
    TColumn["_"]["data"]
  >`${sql.identifier(getTableName(getColumnTable(column)))}.${sql.identifier(column.name)}`;
