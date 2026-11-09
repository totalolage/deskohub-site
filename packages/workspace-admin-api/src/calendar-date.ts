import { Temporal } from "@js-temporal/polyfill";
import { Schema } from "effect";

const isCalendarDate = (value: string) => {
  try {
    return Temporal.PlainDate.from(value).toString() === value;
  } catch {
    return false;
  }
};

export const administrationCalendarDate = Schema.String.check(
  Schema.makeFilter(isCalendarDate, {
    description: "A calendar date in YYYY-MM-DD format.",
  })
).annotate({ format: "date" });
