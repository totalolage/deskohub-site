import { Schema } from "effect";
import { type Instant, instantStringSchema } from "@/shared/utils/temporal";

const decodeInstant = Schema.decodeUnknownSync(instantStringSchema);

/**
 * How long before its booked start an early-setup meeting room is held, and
 * its door code works.
 */
const meetingRoomEarlySetupLeadTime = { minutes: 15 } as const;

/** Whether a meeting-room booking reserves setup time before its start. */
export type MeetingRoomEarlySetup = {
  readonly earlySetup?: boolean | undefined;
};

/** When the customer may arrive to set up a booking that starts then. */
export const getMeetingRoomSetupStart = (bookedStart: Temporal.Instant) =>
  bookedStart.subtract(meetingRoomEarlySetupLeadTime);

/** The booked start of an early-setup booking that is held from then. */
export const getMeetingRoomBookedStart = (setupStart: Temporal.Instant) =>
  setupStart.add(meetingRoomEarlySetupLeadTime);

/**
 * The span a meeting-room booking holds the room: its booked interval, moved
 * earlier by the setup time when the customer comes early. Dotypos stores this
 * span, so overlap, availability, and table assignment respect the setup.
 */
export const getMeetingRoomOccupiedInterval = (
  reservation: MeetingRoomEarlySetup & {
    readonly startsAt: Instant;
    readonly endsAt: Instant;
  }
): { readonly startsAt: Instant; readonly endsAt: Instant } => ({
  startsAt:
    reservation.earlySetup === true
      ? decodeInstant(
          getMeetingRoomSetupStart(
            Temporal.Instant.from(reservation.startsAt)
          ).toString()
        )
      : reservation.startsAt,
  endsAt: reservation.endsAt,
});

/**
 * The early-setup field to copy onto another projection. Bookings without
 * setup leave the key out, so they keep the shape they had before the option.
 */
export const getMeetingRoomEarlySetupField = ({
  earlySetup,
}: MeetingRoomEarlySetup): { readonly earlySetup?: true } =>
  earlySetup === true ? { earlySetup } : {};
