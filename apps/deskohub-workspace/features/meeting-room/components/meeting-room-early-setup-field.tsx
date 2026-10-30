"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useId } from "react";
import type { Control } from "react-hook-form";
import { type Locale, m } from "@/features/i18n";
import type {
  MeetingRoomReservationData,
  MeetingRoomReservationInput,
} from "@/features/reservation/meeting-room-reservation";
import {
  findMeetingRoomStartTime,
  type MeetingRoomStartTimes,
} from "@/features/reservation/workspace-availability";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";

/**
 * Whether the selected start lets the customer come early to set up:
 * `available`, `setup-booked` when the room is booked just before it,
 * `start-unavailable` when the start itself isn't free, `loading` while the
 * free starts load, or `failed` when they can't be loaded.
 */
export type MeetingRoomEarlySetupAvailability =
  | "available"
  | "setup-booked"
  | "start-unavailable"
  | "loading"
  | "failed";

export const getMeetingRoomEarlySetupAvailability = ({
  startTimes,
  startsAt,
}: {
  readonly startTimes: UseQueryResult<MeetingRoomStartTimes>;
  /** The selected booking's start, when the selection books an interval. */
  readonly startsAt: Temporal.Instant | undefined;
}): MeetingRoomEarlySetupAvailability => {
  if (startTimes.isFetching) return "loading";
  if (startTimes.isError) return "failed";
  if (!(startTimes.isSuccess && startsAt)) return "loading";

  const start = findMeetingRoomStartTime(startTimes.data, startsAt);
  if (!start) return "start-unavailable";
  return start.earlySetupAvailable ? "available" : "setup-booked";
};

/** Whether the availability settled on a start that rules early setup out. */
export const isMeetingRoomEarlySetupRuledOut = (
  availability: MeetingRoomEarlySetupAvailability
) => availability === "setup-booked" || availability === "start-unavailable";

type MeetingRoomEarlySetupFieldProps = {
  readonly availability: MeetingRoomEarlySetupAvailability;
  readonly control: Control<
    MeetingRoomReservationInput,
    unknown,
    MeetingRoomReservationData
  >;
  readonly locale: Locale;
};

/**
 * The free option to arrive 15 minutes before the booked start. It stays
 * visible and turns on only when the room is free for the setup time too.
 */
export function MeetingRoomEarlySetupField({
  availability,
  control,
  locale,
}: MeetingRoomEarlySetupFieldProps) {
  const id = useId();
  const reasonId = `${id}-reason`;
  const reason = {
    "setup-booked": m.reservationMeetingRoomEarlySetupUnavailable(
      {},
      { locale }
    ),
    failed: m.reservationMeetingRoomEarlySetupError({}, { locale }),
    available: undefined,
    "start-unavailable": undefined,
    loading: undefined,
  }[availability];

  return (
    <FormField
      control={control}
      name="earlySetup"
      render={({ field }) => (
        <FormItem>
          <ChoiceCard align="center" htmlFor={id}>
            <FormControl aria-describedby={reason ? reasonId : undefined}>
              <Checkbox
                checked={field.value}
                // A choice made earlier can always be removed.
                disabled={!field.value && availability !== "available"}
                id={id}
                onBlur={field.onBlur}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                ref={field.ref}
              />
            </FormControl>
            <span className="text-sm font-medium">
              {m.reservationMeetingRoomEarlySetupLabel({}, { locale })}
            </span>
          </ChoiceCard>
          {/* Stays mounted so the reason is announced when a change of
              time turns the setup choice off. */}
          <p
            aria-live="polite"
            className="text-sm text-navy-blue/70 empty:sr-only"
            id={reasonId}
          >
            {reason}
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
