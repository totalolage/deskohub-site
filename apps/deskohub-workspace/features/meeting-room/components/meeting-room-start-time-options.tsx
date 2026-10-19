"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { type Locale, m } from "@/features/i18n";
import { ReservationSkeletonBlock } from "@/features/reservation/components/reservation-form-fallback";
import {
  type MeetingRoomStartTimes,
  type MeetingRoomStartTimesQuery,
  workspaceAvailabilityKeys,
} from "@/features/reservation/workspace-availability";
import { loadMeetingRoomStartTimes } from "@/features/reservation/workspace-availability-client";
import { cn } from "@/shared/utils";
import { formatInstantTime } from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

type MeetingRoomStartTimeOptionsProps = {
  readonly locale: Locale;
  readonly onSelect: (startDateTime: string) => void;
  readonly query: MeetingRoomStartTimesQuery;
  readonly replacementToken?: string;
  readonly selectedStartDateTime: string;
};

const getStartTimesState = (result: UseQueryResult<MeetingRoomStartTimes>) => {
  if (result.isError) return "error";
  if (result.isPending) return "loading";
  return result.data.startTimes.length === 0 ? "empty" : "ready";
};

/**
 * The free starts on the selected day for the selected duration, as a radio
 * group that sets the start. The list is advisory; the single-interval check
 * stays authoritative before submission.
 */
export function MeetingRoomStartTimeOptions({
  locale,
  onSelect,
  query,
  replacementToken,
  selectedStartDateTime,
}: MeetingRoomStartTimeOptionsProps) {
  const labelId = useId();
  const result = useQuery<MeetingRoomStartTimes>({
    queryKey: [
      ...workspaceAvailabilityKeys.meetingRoomStartTimes(query),
      replacementToken ?? null,
    ],
    queryFn: ({ signal }) =>
      loadMeetingRoomStartTimes({ query, replacementToken, signal }),
    retry: (failureCount) => failureCount < 3,
    staleTime: 30_000,
  });
  const state = getStartTimesState(result);
  const startTimes = state === "ready" ? result.data?.startTimes : undefined;

  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium text-navy-blue/80">
        {m.reservationMeetingRoomStartTimesLabel({}, { locale })}
      </p>
      {state === "loading" && (
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          {["a", "b", "c", "d", "e", "f"].map((key) => (
            <ReservationSkeletonBlock
              key={key}
              className="h-9 w-18 rounded-full"
            />
          ))}
        </div>
      )}
      {startTimes && (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="flex flex-wrap gap-2"
        >
          {startTimes.map(({ startDateTime, startsAt }) => {
            const isSelected = startDateTime === selectedStartDateTime;
            return (
              <label
                key={startDateTime}
                className={cn(
                  "cursor-pointer rounded-full px-4 py-2 text-sm font-medium tabular-nums outline outline-1 -outline-offset-1 transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-burned-orange",
                  isSelected
                    ? "bg-burned-orange/8 text-burned-orange-ink outline-burned-orange ring-4 ring-burned-orange/10"
                    : "bg-white text-navy-blue outline-navy-blue/10 hover:outline-burned-orange/45"
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`${labelId}-start-time`}
                  value={startDateTime}
                  checked={isSelected}
                  onChange={() => onSelect(startDateTime)}
                />
                {formatInstantTime({
                  instant: Temporal.Instant.from(startsAt),
                  locale,
                  timeZone: workspaceSiteConstants.location.timeZone,
                })}
              </label>
            );
          })}
        </div>
      )}
      <p
        aria-live="polite"
        className={cn(
          "text-sm text-navy-blue/70",
          state === "loading" && "sr-only"
        )}
      >
        {
          {
            error: m.reservationMeetingRoomStartTimesError({}, { locale }),
            loading: m.reservationMeetingRoomStartTimesLoading({}, { locale }),
            empty: m.reservationMeetingRoomStartTimesEmpty({}, { locale }),
            ready: undefined,
          }[state]
        }
      </p>
    </div>
  );
}
