import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import type { MeetingRoomEarlySetup } from "@/features/reservation/meeting-room-early-setup";
import {
  getMeetingRoomReservationDefaultValues,
  type MeetingRoomReservationInput,
  meetingRoomReservationDefaultValues,
  meetingRoomStartDateTimeSchema,
  type NormalizedMeetingRoomReservationOrder,
  type StoredMeetingRoomReservationDetails,
} from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDuration,
  getMeetingRoomReservationDurationKey,
  meetingRoomReservationDurationKeySchema,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  findMeetingRoomReservationDuration,
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomReservationInterval,
  getMeetingRoomStartDateTime,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  decodeReservationCheckoutCustomer,
  getTrimmedSearchParam,
  hasReservationSelectionSearchParams,
  type ReservationSelectionSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import { hasReservationIntervalEnded } from "@/features/reservation/reservation-interval";
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
  // A linked start stays while its interval has not ended, the same rule the
  // picker minimum and the reservation schema apply.
  const startDateTimeOrEarliest =
    startDateTime !== undefined &&
    startInterval !== null &&
    !hasReservationIntervalEnded(startInterval, now)
      ? startDateTime
      : getEarliestMeetingRoomStartDateTime(duration, now);

  return {
    ...meetingRoomReservationDefaultValues,
    ...decodeReservationCheckoutCustomer(searchParams),
    duration: getMeetingRoomReservationDurationKey(duration),
    startDateTime: startDateTimeOrEarliest,
    // Only a link that asks for setup time turns it on; it is never filled
    // from the last reservation.
    earlySetup:
      getTrimmedSearchParam(searchParams, earlySetupQueryParam) ===
      earlySetupQueryValue,
    marketingConsent: false,
  };
};

const earlySetupQueryParam = "earlySetup";
const earlySetupQueryValue = "true";

/**
 * A meeting-room reservation-page link that also asks for the setup time, for
 * a customer who chose it after the link was made.
 */
export const withMeetingRoomEarlySetup = (reservationUrl: string) => {
  const link = new URL(reservationUrl);
  link.searchParams.set(earlySetupQueryParam, earlySetupQueryValue);
  return link.toString();
};

/** The meeting-room selection as the link parameters the parser above reads. */
export const getMeetingRoomReservationSelectionSearchParams = (
  selection: Pick<MeetingRoomReservationInput, "startDateTime" | "duration"> &
    MeetingRoomEarlySetup
): ReservationSelectionSearchParams => ({
  startDateTime: selection.startDateTime || undefined,
  duration: selection.duration,
  [earlySetupQueryParam]:
    selection.earlySetup === true ? earlySetupQueryValue : undefined,
});

/**
 * A stored meeting-room reservation's selection as link parameters, so a
 * retried checkout reopens the form on the same start, duration, and setup
 * choice. `reservedFrom` is the booked start, after any setup time. A row
 * without a recorded duration takes the one its interval matches.
 */
export const getStoredMeetingRoomReservationSelectionSearchParams = (
  reservation: StoredMeetingRoomReservationDetails & {
    readonly reservedFrom: Temporal.Instant;
    readonly reservedUntil: Temporal.Instant;
  }
): ReservationSelectionSearchParams | undefined => {
  const duration =
    reservation.duration ??
    findMeetingRoomReservationDuration({
      startsAt: reservation.reservedFrom,
      endsAt: reservation.reservedUntil,
    });

  return (
    duration &&
    getMeetingRoomReservationSelectionSearchParams({
      startDateTime: getMeetingRoomStartDateTime(reservation.reservedFrom),
      duration: getMeetingRoomReservationDurationKey(duration),
      earlySetup: reservation.earlySetup,
    })
  );
};

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

  const { startDateTime, duration, earlySetup } =
    getMeetingRoomReservationDefaultValuesFromSearchParams(searchParams, now);
  return { ...restoredValues, startDateTime, duration, earlySetup };
};
