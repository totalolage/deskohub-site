"use client";

import { useMemo } from "react";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import { getOfficeReservationMaximumEndsOn } from "@/features/reservation/office-reservation";
import {
  getOfficeAvailabilityQuery,
  type PreloadedWorkspaceAvailability,
} from "@/features/reservation/workspace-availability";

/**
 * The office calendar's availability from today, and the last day the
 * booking window reaches.
 */
export const useOfficeAvailability = ({
  initialAvailability,
  replacementToken,
  today,
}: {
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly replacementToken?: string;
  readonly today: string;
}) => {
  const maximumEndsOn = getOfficeReservationMaximumEndsOn(
    Temporal.PlainDate.from(today)
  ).toString();
  const availabilityQuery = useMemo(
    () => getOfficeAvailabilityQuery(today),
    [today]
  );
  const availabilityResult = useReservationAvailability(availabilityQuery, {
    initialAvailability,
    replacementToken,
  });

  return { availabilityResult, maximumEndsOn };
};
