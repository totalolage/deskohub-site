import { Schema } from "effect";
import { type PlainDate, plainDateStringSchema } from "@/shared/utils/temporal";

const isCanonicalDate = Schema.is(plainDateStringSchema);

export type ServiceDateWindow = {
  readonly serviceDateFrom: PlainDate | null;
  readonly serviceDateUntil: PlainDate | null;
};

/**
 * Whether a reservation's canonical start date falls inside a promotion's
 * service window. The start date is inclusive and the end date is exclusive.
 * A half-open window (only one bound stored) fails closed, as does a
 * reservation date that is not a canonical calendar date.
 */
export const isReservationServiceDateEligible = (
  serviceDates: ServiceDateWindow,
  reservationDate: string
): boolean => {
  const { serviceDateFrom, serviceDateUntil } = serviceDates;
  if (serviceDateFrom === null || serviceDateUntil === null) {
    return serviceDateFrom === null && serviceDateUntil === null;
  }
  if (!isCanonicalDate(reservationDate)) return false;

  return (
    serviceDateFrom <= reservationDate && reservationDate < serviceDateUntil
  );
};
