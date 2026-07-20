import { customType } from "drizzle-orm/pg-core";

export const instant = customType<{
  data: Temporal.Instant;
  driverData: string;
}>({
  dataType: () => "timestamp with time zone",
  codec: "timestamptz:string",
  fromDriver: (value) => Temporal.Instant.from(value),
  toDriver: (value) => value.toString({ smallestUnit: "microsecond" }),
});
