"use client";

import { useMemo } from "react";
import { type Locale, m } from "@/features/i18n";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import type { MeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import type { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import {
  getMeetingRoomSelectionAvailabilityQuery,
  isMeetingRoomAvailable,
  type PreloadedWorkspaceAvailability,
} from "@/features/reservation/workspace-availability";

type AvailabilityQueryResult = ReturnType<typeof useReservationAvailability>;

/**
 * The message that blocks checkout: the room is taken for the selected
 * interval, or, once nothing loads any more, its availability failed.
 */
const getMeetingRoomUnavailableMessage = ({
  hasQuery,
  locale,
  queryResult: { availability, isError, isPending },
  selectedInterval,
}: {
  readonly hasQuery: boolean;
  readonly locale: Locale;
  readonly queryResult: AvailabilityQueryResult;
  readonly selectedInterval: ReturnType<
    typeof getMeetingRoomReservationInterval
  >;
}) => {
  if (
    selectedInterval &&
    availability &&
    !isMeetingRoomAvailable(availability)
  ) {
    return m.reservationMeetingRoomUnavailable({}, { locale });
  }
  return hasQuery && isError && !isPending
    ? m.reservationAvailabilityError({}, { locale })
    : undefined;
};

/** The meeting room's availability for the selected start and duration. */
export const useMeetingRoomSelectionAvailability = ({
  initialAvailability,
  locale,
  replacementToken,
  selectedInterval,
  selection: { duration, startDateTime },
}: {
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly selectedInterval: ReturnType<
    typeof getMeetingRoomReservationInterval
  >;
  readonly selection: {
    readonly duration: MeetingRoomReservationDurationKey;
    readonly startDateTime: string;
  };
}) => {
  const query = useMemo(
    () => getMeetingRoomSelectionAvailabilityQuery({ duration, startDateTime }),
    [duration, startDateTime]
  );
  const queryResult = useReservationAvailability(query, {
    debounceMs: 250,
    initialAvailability,
    replacementToken,
  });

  return {
    isPending: queryResult.isPending,
    unavailableMessage: getMeetingRoomUnavailableMessage({
      hasQuery: Boolean(query),
      locale,
      queryResult,
      selectedInterval,
    }),
  };
};
