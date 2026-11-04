"use client";

import { useQuery } from "@tanstack/react-query";
import type { MeetingRoomStartTimesQuery } from "@/features/reservation/workspace-availability";
import { meetingRoomStartTimesQueryOptions } from "@/features/reservation/workspace-availability-client";

/**
 * The free meeting-room starts on the selected date for the selected
 * duration, each with whether its setup time is free too. Advisory: the
 * single-interval check and submission stay authoritative.
 */
export const useMeetingRoomStartTimes = ({
  query,
  replacementToken,
}: {
  readonly query: MeetingRoomStartTimesQuery | undefined;
  readonly replacementToken?: string;
}) => useQuery(meetingRoomStartTimesQueryOptions({ query, replacementToken }));
