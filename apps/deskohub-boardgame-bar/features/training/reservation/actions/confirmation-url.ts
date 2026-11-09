import type { ReservationFormData } from "../schemas/reservation";

/** The requester fields the confirmation page names the reservation by, in query order. */
const requesterFields = ["company", "firstName", "lastName", "role"] as const;

/**
 * Builds the confirmation page URL that carries the submitted reservation in
 * its query. Empty optional fields stay out of the query.
 */
export function trainingReservationConfirmationUrl(
  input: ReservationFormData
): string {
  const params = new URLSearchParams();

  for (const field of requesterFields) {
    const value = input[field];
    if (value) {
      params.set(field, value);
    }
  }

  params.set("email", input.email);
  params.set("phone", input.phone);
  params.set("date", input.date.toISOString());
  params.set("time", input.time);
  params.set("duration", input.duration.toString());

  if (input.specialRequirements) {
    params.set("specialRequirements", input.specialRequirements);
  }

  return `/training-room/reservation/confirmation?${params.toString()}`;
}
