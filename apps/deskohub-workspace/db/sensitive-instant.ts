import { customType } from "drizzle-orm/pg-core";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";

/** An instant whose bound value is censored by the database query logger. */
export const sensitiveInstant = customType<{
  data: Temporal.Instant;
  driverData: string;
}>({
  dataType: () => "timestamp with time zone",
  codec: "timestamptz:string",
  fromDriver: (value) => Temporal.Instant.from(value),
  toDriver: (value) =>
    sensitiveDatabaseParameter(value.toString({ smallestUnit: "microsecond" })),
});
