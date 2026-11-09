import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  type MeetingRoomReservationInput,
  meetingRoomReservationDefaultValues,
  meetingRoomStartDateTimeSchema,
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
} from "@/features/reservation/reservation-checkout-query";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import { hasReservationIntervalEnded } from "@/features/reservation/reservation-interval";
import { defineSelectionLink } from "@/features/reservation/selection-link";
import type { SupportedSearchParams } from "@/shared/utils";
import { meetingRoomEarlySetupSearchParam } from "./meeting-room-early-setup-link";

const queryMeetingRoomStartDateTimeSchema = Schema.toStandardSchemaV1(
  meetingRoomStartDateTimeSchema
);
const queryMeetingRoomDurationKeySchema = Schema.toStandardSchemaV1(
  meetingRoomReservationDurationKeySchema
);

type MeetingRoomSelection = Partial<
  Pick<MeetingRoomReservationInput, "startDateTime" | "duration" | "earlySetup">
>;

/**
 * The meeting-room reservation page's link. A link without a start opens the
 * page on the earliest start for its duration.
 */
export const meetingRoomSelectionLink = defineSelectionLink({
  kind: "meeting-room",
  params: ["startDateTime", "duration", "earlySetup"],
  read: (
    searchParams: SupportedSearchParams,
    {
      now = Temporal.Now.instant(),
      lastReservation,
    }: {
      readonly now?: Temporal.Instant;
      readonly lastReservation?: CustomerLastReservationForKind<"meeting-room">;
    } = {}
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
      earlySetup:
        getTrimmedSearchParam(
          searchParams,
          meetingRoomEarlySetupSearchParam.name
        ) === meetingRoomEarlySetupSearchParam.value,
      marketingConsent: false,
    };
  },
  write: (selection: MeetingRoomSelection) => ({
    startDateTime: selection.startDateTime || undefined,
    duration: selection.duration,
    earlySetup:
      selection.earlySetup === true
        ? meetingRoomEarlySetupSearchParam.value
        : undefined,
  }),
  /**
   * The stored start and duration. A row without a recorded duration takes
   * the one its interval matches.
   */
  fromStored: (
    reservation: StoredMeetingRoomReservationDetails & {
      readonly reservedFrom: Temporal.Instant;
      readonly reservedUntil: Temporal.Instant;
    }
  ): MeetingRoomSelection | undefined => {
    const duration =
      reservation.duration ??
      findMeetingRoomReservationDuration({
        startsAt: reservation.reservedFrom,
        endsAt: reservation.reservedUntil,
      });

    return duration === undefined
      ? undefined
      : {
          startDateTime: getMeetingRoomStartDateTime(reservation.reservedFrom),
          duration: getMeetingRoomReservationDurationKey(duration),
          earlySetup: reservation.earlySetup === true,
        };
  },
});
