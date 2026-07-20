import { Temporal } from "@js-temporal/polyfill";
import { customType } from "drizzle-orm/pg-core";
import type { TemporalInstant } from "@/shared/utils/temporal";

export const instant = customType<{
  data: TemporalInstant;
  driverData: string;
}>({
  dataType: () => "timestamp with time zone",
  codec: "timestamptz:string",
  fromDriver: (value) => Temporal.Instant.from(value),
  toDriver: (value) => value.toString({ smallestUnit: "microsecond" }),
});
