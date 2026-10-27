"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type MeetingRoomStartTimes,
  type MeetingRoomStartTimesQuery,
  workspaceAvailabilityKeys,
} from "@/features/reservation/workspace-availability";
import { loadMeetingRoomStartTimes } from "@/features/reservation/workspace-availability-client";

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
}) =>
  useQuery<MeetingRoomStartTimes>({
    queryKey: [
      ...workspaceAvailabilityKeys.meetingRoomStartTimes(query),
      replacementToken ?? null,
    ],
    queryFn: query
      ? ({ signal }) =>
          loadMeetingRoomStartTimes({ query, replacementToken, signal })
      : skipToken,
    retry: (failureCount) => failureCount < 3,
    staleTime: 30_000,
  });
