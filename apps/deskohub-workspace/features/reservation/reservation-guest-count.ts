import { Schema } from "effect";

export const dotyposReservationGuestCountSchema = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
).annotate({
  identifier: "DotyposReservationGuestCount",
  description: "Positive integer guest count returned by Dotypos.",
});
