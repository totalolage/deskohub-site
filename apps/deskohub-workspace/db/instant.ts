import { customType } from "drizzle-orm/pg-core";

/**
 * Returns the instant as a `timestamptz` column stores it. `Temporal.Now`
 * carries nanoseconds that PostgreSQL drops, so compare an in-memory instant
 * with a stored one only after passing both through this.
 */
export const toStoredInstant = (value: Temporal.Instant) =>
  value.round({ smallestUnit: "microsecond", roundingMode: "trunc" });

export const instant = customType<{
  data: Temporal.Instant;
  driverData: string;
}>({
  dataType: () => "timestamp with time zone",
  codec: "timestamptz:string",
  fromDriver: (value) => Temporal.Instant.from(value),
  toDriver: (value) => value.toString({ smallestUnit: "microsecond" }),
});
