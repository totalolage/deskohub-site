import { Schema } from "effect";

/**
 * Why the customer books: for themselves or for a business. Billing rules
 * build on it, but it stands alone so `db/schema` can constrain the stored
 * column without loading billing validation and its localized messages.
 */
export const reservationPurposeSchema = Schema.Literals([
  "personal",
  "business",
]);
export type ReservationPurpose = typeof reservationPurposeSchema.Type;
