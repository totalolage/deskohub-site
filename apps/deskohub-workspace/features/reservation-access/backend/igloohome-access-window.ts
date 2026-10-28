import { workspaceSiteConstants } from "@/shared/utils";
import { ceilToWholeHour, floorToWholeHour } from "@/shared/utils/temporal";

/**
 * The whole Prague hours an hourly AlgoPIN for a span is programmed with. A
 * grant's stored bounds identify the same target when they round to the same
 * hours, whether a release stored the whole hours or the exact span.
 */
export const getReservationAccessSchedule = (input: {
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
}) => {
  const timeZone = workspaceSiteConstants.location.timeZone;
  return {
    startsAt: floorToWholeHour(input.reservedFrom.toZonedDateTimeISO(timeZone)),
    endsAt: ceilToWholeHour(input.reservedUntil.toZonedDateTimeISO(timeZone)),
  };
};
