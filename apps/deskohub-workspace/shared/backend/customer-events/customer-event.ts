import { Schema } from "effect";

/**
 * What a customer event records. Booked, cancelled and account-created
 * events come from Workspace's own writes, in the same transaction; started
 * and finished come from the reservation activity sweep over Dotypos.
 */
export const customerEventKinds = [
  "reservation-booked",
  "reservation-cancelled",
  "reservation-started",
  "reservation-finished",
  "account-created",
] as const;
const customerEventKindSchema = Schema.Literals(customerEventKinds);
export type CustomerEventKind = typeof customerEventKindSchema.Type;

/** Kinds that name a Workspace reservation. */
export const reservationCustomerEventKinds = [
  "reservation-booked",
  "reservation-cancelled",
  "reservation-started",
  "reservation-finished",
] as const satisfies ReadonlyArray<CustomerEventKind>;

const customerEventIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CustomerEventId")
).annotate({
  identifier: "CustomerEventId",
  description: "Database-generated identifier of one recorded customer event.",
});
export type CustomerEventId = typeof customerEventIdSchema.Type;

/**
 * The sweeps that page Dotypos for reservations active in a time window.
 * `reservation-activity` follows the clock; `reservation-activity-reconcile`
 * re-pages the last 24 hours once an hour for visits moved into swept time.
 */
export const customerEventSweepSources = [
  "reservation-activity",
  "reservation-activity-reconcile",
] as const;
export const customerEventSweepSourceSchema = Schema.Literals(
  customerEventSweepSources
);
export type CustomerEventSweepSource =
  typeof customerEventSweepSourceSchema.Type;
