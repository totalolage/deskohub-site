import { customType } from "drizzle-orm/pg-core";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";

/**
 * A `text` column whose values the database query log censors. Its encoder
 * marks every value Drizzle binds for the column: insert values, update and
 * `onConflictDoUpdate` sets, and `eq`, `ne` and `inArray` predicates.
 *
 * Values that skip the column's encoder stay visible: raw `sql` templates,
 * `like`, expressions such as `lower(column)`, placeholders, and `equalsAny`,
 * which takes only plain text columns. Mark those with
 * `sensitiveDatabaseParameter` where they are bound.
 */
export const sensitiveText = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => sensitiveDatabaseParameter(value),
});
