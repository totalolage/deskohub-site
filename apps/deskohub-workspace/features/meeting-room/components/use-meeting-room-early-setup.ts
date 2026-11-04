"use client";

import { useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import type {
  MeetingRoomReservationData,
  MeetingRoomReservationInput,
} from "@/features/reservation/meeting-room-reservation";
import type { MeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import type { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { getMeetingRoomStartTimesQuery } from "@/features/reservation/workspace-availability";
import {
  getMeetingRoomEarlySetupAvailability,
  isMeetingRoomEarlySetupRuledOut,
} from "./meeting-room-early-setup-field";
import { useMeetingRoomStartTimes } from "./use-meeting-room-start-times";

/**
 * The selected day's start times and whether the selected start's setup time
 * is free. Changing to a start whose setup time is taken drops the setup
 * choice; loading or failed starts keep it, and submission checks it again.
 */
export const useMeetingRoomEarlySetup = ({
  earlySetup,
  form,
  replacementToken,
  selectedInterval,
  selection: { duration, startDateTime },
}: {
  readonly earlySetup: boolean | undefined;
  readonly form: UseFormReturn<
    MeetingRoomReservationInput,
    unknown,
    MeetingRoomReservationData
  >;
  readonly replacementToken?: string;
  readonly selectedInterval: ReturnType<
    typeof getMeetingRoomReservationInterval
  >;
  readonly selection: {
    readonly duration: MeetingRoomReservationDurationKey;
    readonly startDateTime: string;
  };
}) => {
  // A whole day lists no starts, but its midnight start's entry still says
  // whether its setup time is free.
  const startTimesQuery = getMeetingRoomStartTimesQuery({
    duration,
    startDateTime,
  });
  const startTimes = useMeetingRoomStartTimes({
    query: startTimesQuery,
    replacementToken,
  });
  const availability = getMeetingRoomEarlySetupAvailability({
    startTimes,
    startsAt: selectedInterval
      ? Temporal.Instant.from(selectedInterval.startsAt)
      : undefined,
  });
  const isRuledOut = isMeetingRoomEarlySetupRuledOut(availability);

  useEffect(() => {
    if (earlySetup && isRuledOut) {
      form.setValue("earlySetup", false, { shouldValidate: true });
    }
  }, [earlySetup, form, isRuledOut]);

  return { availability, startTimes, startTimesQuery };
};
