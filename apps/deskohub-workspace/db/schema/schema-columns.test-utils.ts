import { type Column, getTableColumns, is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import { getSensitiveDatabaseQueryParameterIndexes } from "@/shared/backend/logging/database-query-parameter-classifier";
import * as authSchema from "./auth";
import * as workspaceSchema from "./index";

const dialect = new PgDialect();

/** Whether the column's encoder marks every value it binds as sensitive. */
const isSensitiveColumn = (column: Column) => {
  const encoded = column.mapToDriverValue("synthetic");
  return (
    is(encoded, SQL) &&
    getSensitiveDatabaseQueryParameterIndexes(dialect.sqlToQuery(encoded).sql)
      .size > 0
  );
};

// Drizzle-kit generates migrations from exactly these two modules.
export const schemaTables = Object.entries({
  ...workspaceSchema,
  ...authSchema,
}).flatMap(([exportName, value]) => {
  if (!is(value, PgTable)) return [];
  const config = getTableConfig(value);
  return [
    {
      exportName,
      table: value as PgTable,
      name: config.name,
      id: `${config.schema ?? "public"}.${config.name}`,
    },
  ];
});

/** Every schema column, identified as `schema.table.column`. */
export const schemaColumns = schemaTables.flatMap(
  ({ exportName, table, name, id }) =>
    Object.entries(getTableColumns(table)).map(([key, column]) => ({
      id: `${id}.${column.name}`,
      exportName,
      key,
      table,
      tableName: name,
      column,
      words: column.name.split("_"),
      sqlType: column.getSQLType(),
      sensitive: isSensitiveColumn(column),
    }))
);

/** Whether `words` contains `fragment` as a run of whole words. */
export const containsWordRun = (
  words: readonly string[],
  fragment: readonly string[]
) =>
  words.some((_, start) =>
    fragment.every((word, offset) => words[start + offset] === word)
  );
