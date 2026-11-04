"use client";

import { Predicate } from "effect";
import { useEffect, useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import type { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import { useReservationSelectionUrl } from "@/features/reservation/components/use-reservation-selection-url";
import {
  getOfficeReservationMaximumDayCount,
  type OfficeReservationData,
  type OfficeReservationInput,
} from "@/features/reservation/office-reservation";
import { officeSelectionLink } from "@/features/reservation/office-selection-link";
import { getReservationCheckoutAvailability } from "@/features/reservation/reservation.i18n";

type OfficeSelection = Pick<
  OfficeReservationInput,
  "startsOn" | "dayCount" | "seats"
>;

/** Whether the chosen start has no free day, or the stay runs past one. */
const isOfficeStayUnavailable = ({
  dayCount,
  maximumDayCount,
  startsOn,
}: {
  readonly dayCount: OfficeSelection["dayCount"];
  readonly maximumDayCount: number;
  readonly startsOn: OfficeSelection["startsOn"];
}) =>
  Boolean(
    startsOn &&
      (maximumDayCount === 0 ||
        (Predicate.isNumber(dayCount) && dayCount > maximumDayCount))
  );

/**
 * How many days the chosen start can run before an unavailable date or the
 * booking window's end. A longer stay shortens to fit, and only a fitting
 * selection is written to the URL.
 */
export const useOfficeDayCountBounds = ({
  availabilityResult,
  form,
  locale,
  maximumEndsOn,
  selection,
}: {
  readonly availabilityResult: ReturnType<typeof useReservationAvailability>;
  readonly form: UseFormReturn<
    OfficeReservationInput,
    unknown,
    OfficeReservationData
  >;
  readonly locale: Locale;
  readonly maximumEndsOn: string;
  readonly selection: OfficeSelection;
}) => {
  const { startsOn, dayCount } = selection;
  const unavailableDates = useMemo(
    () => new Set(availabilityResult.availability?.unavailableDates ?? []),
    [availabilityResult.availability]
  );
  const maximumDayCount = startsOn
    ? getOfficeReservationMaximumDayCount({
        startsOn,
        maximumEndsOn: Temporal.PlainDate.from(maximumEndsOn),
        unavailableDates: [...unavailableDates],
      })
    : 0;
  useEffect(() => {
    if (
      maximumDayCount > 0 &&
      Predicate.isNumber(dayCount) &&
      dayCount > maximumDayCount
    ) {
      form.setValue("dayCount", maximumDayCount, { shouldValidate: true });
    }
  }, [dayCount, form, maximumDayCount]);
  useReservationSelectionUrl(
    officeSelectionLink,
    startsOn && Predicate.isNumber(dayCount) && dayCount <= maximumDayCount
      ? selection
      : undefined
  );

  return {
    availability: getReservationCheckoutAvailability({
      isError: availabilityResult.isError,
      isPending: availabilityResult.isPending,
      locale,
      unavailable: isOfficeStayUnavailable({
        dayCount,
        maximumDayCount,
        startsOn,
      })
        ? { date: startsOn, reservation: { kind: "office" } }
        : undefined,
    }),
    maximumDayCount,
    unavailableDates,
  };
};
