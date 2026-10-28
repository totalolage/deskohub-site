/**
 * How long before its booked start an early-setup meeting room is held, and
 * its door code works.
 */
const meetingRoomEarlySetupLeadTime = { minutes: 15 } as const;

/** The booked start of an early-setup booking that is held from then. */
export const getMeetingRoomBookedStart = (setupStart: Temporal.Instant) =>
  setupStart.add(meetingRoomEarlySetupLeadTime);
