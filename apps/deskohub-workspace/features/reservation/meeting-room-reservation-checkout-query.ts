import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  getMeetingRoomReservationDefaultValues,
  type MeetingRoomReservationInput,
  meetingRoomReservationDefaultValues,
  meetingRoomStartDateTimeSchema,
  type NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDuration,
  getMeetingRoomReservationDurationKey,
  meetingRoomReservationDurationKeySchema,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  decodeReservationCheckoutCustomer,
  getTrimmedSearchParam,
  hasReservationSelectionSearchParams,
  type ReservationSelectionSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import type { SupportedSearchParams } from "@/shared/utils";

const queryMeetingRoomStartDateTimeSchema = Schema.toStandardSchemaV1(
  meetingRoomStartDateTimeSchema
);
const queryMeetingRoomDurationKeySchema = Schema.toStandardSchemaV1(
  meetingRoomReservationDurationKeySchema
);

export const getMeetingRoomReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams,
  now = Temporal.Now.instant(),
  lastReservation?: CustomerLastReservationForKind<"meeting-room">
): MeetingRoomReservationInput => {
  const durationKey = decodeStandardSchema(
    queryMeetingRoomDurationKeySchema,
    getTrimmedSearchParam(searchParams, "duration")
  );
  const duration = getMeetingRoomReservationDuration(
    durationKey ??
      lastReservation?.duration ??
      meetingRoomReservationDefaultValues.duration
  );

  const startDateTime = decodeStandardSchema(
    queryMeetingRoomStartDateTimeSchema,
    getTrimmedSearchParam(searchParams, "startDateTime")
  );
  const startInterval =
    startDateTime === undefined
      ? null
      : getMeetingRoomReservationInterval(startDateTime, duration);
  // Fresh query decoding rejects any start at or before now, even when the
  // interval end is still in the future; submission keeps its own end-based
  // rule inside the reservation schema.
  const startDateTimeOrEarliest =
    startDateTime !== undefined &&
    startInterval !== null &&
    Temporal.Instant.compare(startInterval.startsAt, now) >= 0
      ? startDateTime
      : getEarliestMeetingRoomStartDateTime(duration, now);

  return {
    ...meetingRoomReservationDefaultValues,
    ...decodeReservationCheckoutCustomer(searchParams),
    duration: getMeetingRoomReservationDurationKey(duration),
    startDateTime: startDateTimeOrEarliest,
    marketingConsent: false,
  };
};

/** The meeting-room selection as the link parameters the parser above reads. */
export const getMeetingRoomReservationSelectionSearchParams = (
  selection: Pick<MeetingRoomReservationInput, "startDateTime" | "duration">
): ReservationSelectionSearchParams => ({
  startDateTime: selection.startDateTime || undefined,
  duration: selection.duration,
});

/**
 * The form values for a signed meeting-room restoration, with the selection
 * the customer edited into the URL after returning from Pay. A restoration
 * whose interval has ended restores nothing.
 */
export const getMeetingRoomRestoredReservationValues = (
  reservation: NormalizedMeetingRoomReservationOrder,
  searchParams: SupportedSearchParams,
  now = Temporal.Now.instant()
): MeetingRoomReservationInput | undefined => {
  const restoredValues = getMeetingRoomReservationDefaultValues(reservation);
  if (
    !restoredValues ||
    !hasReservationSelectionSearchParams(searchParams, [
      "startDateTime",
      "duration",
    ])
  ) {
    return restoredValues;
  }

  const { startDateTime, duration } =
    getMeetingRoomReservationDefaultValuesFromSearchParams(searchParams, now);
  return { ...restoredValues, startDateTime, duration };
};
