/**
 * The reservation-page link parameter that asks for a meeting room's setup
 * time. A leaf module, so the agent booking view can carry the choice without
 * bundling the reservation form's link parser.
 */
export const meetingRoomEarlySetupSearchParam = {
  name: "earlySetup",
  value: "true",
} as const;

/**
 * A meeting-room reservation-page link that also asks for the setup time, for
 * a customer who chose it after the link was made.
 */
export const withMeetingRoomEarlySetup = (reservationUrl: string) => {
  const link = new URL(reservationUrl);
  link.searchParams.set(
    meetingRoomEarlySetupSearchParam.name,
    meetingRoomEarlySetupSearchParam.value
  );
  return link.toString();
};
