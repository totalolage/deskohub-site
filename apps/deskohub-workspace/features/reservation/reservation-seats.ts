import { Schema } from "effect";

export const dotyposReservationSeatsSchema = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
).annotate({
  identifier: "DotyposReservationSeats",
  description: "Positive integer seat count returned by Dotypos.",
});
