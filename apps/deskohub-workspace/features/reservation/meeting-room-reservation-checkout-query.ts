import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  type MeetingRoomReservationInput,
  meetingRoomReservationDefaultValues,
  meetingRoomStartDateTimeSchema,
} from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDuration,
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDurationKey,
  meetingRoomReservationDurationKeySchema,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  decodeReservationCheckoutCustomer,
  getTrimmedSearchParam,
} from "@/features/reservation/reservation-checkout-query";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import type { SupportedSearchParams } from "@/shared/utils";

const queryMeetingRoomStartDateTimeSchema = Schema.toStandardSchemaV1(
  meetingRoomStartDateTimeSchema
);
const queryMeetingRoomDurationKeySchema = Schema.toStandardSchemaV1(
  meetingRoomReservationDurationKeySchema
);

/**
 * The query of a link that opens the meeting-room form on a selection, which
 * `getMeetingRoomReservationDefaultValuesFromSearchParams` reads back.
 */
export const getMeetingRoomReservationSearchParams = (selection: {
  readonly duration: MeetingRoomReservationDurationKey;
  readonly startDateTime?: string;
}) =>
  new URLSearchParams({
    duration: selection.duration,
    ...(selection.startDateTime !== undefined && {
      startDateTime: selection.startDateTime,
    }),
  });

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
  // A link keeps any start the form's picker offers: the interval may have
  // begun while its end is still ahead, the bound submission applies too.
  const earliestStartDateTime = getEarliestMeetingRoomStartDateTime(
    duration,
    now
  );
  const startDateTimeOrEarliest =
    startDateTime !== undefined &&
    getMeetingRoomReservationInterval(startDateTime, duration) !== null &&
    Temporal.PlainDateTime.compare(startDateTime, earliestStartDateTime) >= 0
      ? startDateTime
      : earliestStartDateTime;

  return {
    ...meetingRoomReservationDefaultValues,
    ...decodeReservationCheckoutCustomer(searchParams),
    duration: getMeetingRoomReservationDurationKey(duration),
    startDateTime: startDateTimeOrEarliest,
    marketingConsent: false,
  };
};
