"use client";

import { useMemo } from "react";
import { type Locale, m } from "@/features/i18n";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import type { CoworkReservationInput } from "@/features/reservation/cowork-reservation";
import { evaluateCoworkSelectionAvailability } from "@/features/reservation/cowork-selection-availability";
import { getReservationCheckoutAvailability } from "@/features/reservation/reservation.i18n";
import {
  getCoworkAvailabilityQueries,
  type PreloadedWorkspaceAvailability,
} from "@/features/reservation/workspace-availability";

/**
 * The cowork selection's availability: the selected day, the calendar range,
 * and the Reserved Desk workstation requirement, with the checkout state they
 * leave for the selected offer.
 */
export const useCoworkSelectionAvailability = ({
  initialAvailability,
  locale,
  replacementToken,
  selection: { date, entryTier, monitorOption },
  today,
}: {
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly selection: Pick<
    CoworkReservationInput,
    "date" | "entryTier" | "monitorOption"
  >;
  readonly today: string;
}) => {
  const queries = useMemo(
    () =>
      getCoworkAvailabilityQueries({ date, entryTier, monitorOption, today }),
    [date, entryTier, monitorOption, today]
  );
  const queryOptions = { initialAvailability, replacementToken };
  const selectionResult = useReservationAvailability(
    queries.selection,
    queryOptions
  );
  const rangeResult = useReservationAvailability(queries.range, queryOptions);
  const workstationRequirementResult = useReservationAvailability(
    queries.workstationRequirement,
    queryOptions
  );
  const availability = evaluateCoworkSelectionAvailability(
    {
      range: rangeResult,
      selection: selectionResult,
      workstationRequirement: workstationRequirementResult,
    },
    { date, entryTier, monitorOption }
  );
  const { checkout } = availability;

  return {
    ...availability,
    checkoutAvailability: getReservationCheckoutAvailability({
      isError: checkout.isError,
      isPending: checkout.isPending,
      locale,
      unavailable: checkout.unavailable && {
        date,
        dateFallback: m.reservationDatePlaceholder({}, { locale }),
        reservation: checkout.unavailable,
      },
    }),
  };
};
