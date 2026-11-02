"use client";

import { useMemo } from "react";
import type { WorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import { type Locale, m } from "@/features/i18n";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import {
  type CoworkReservationInput,
  getAllowedMonitorOptionsForCoworkTier,
} from "@/features/reservation/cowork-reservation";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import {
  getCoworkAvailabilityQueries,
  type PreloadedWorkspaceAvailability,
  type WorkspaceAvailability,
} from "@/features/reservation/workspace-availability";

type AvailabilityQueryResult = ReturnType<typeof useReservationAvailability>;

type CoworkAvailabilityQuery = ReturnType<
  typeof getCoworkAvailabilityQueries
>["selection"];

type CoworkAvailabilitySelection = Pick<
  CoworkReservationInput,
  "date" | "entryTier" | "monitorOption"
>;

const isQueryResultSettled = (queryResult: AvailabilityQueryResult) =>
  queryResult.isSuccess &&
  !queryResult.isError &&
  !queryResult.isPlaceholderData;

/** The range query's availability once its own range has settled, else null. */
const getSettledRangeAvailability = (
  query: CoworkAvailabilityQuery,
  queryResult: AvailabilityQueryResult
) =>
  query &&
  queryResult.availability?.from === query.from &&
  queryResult.availability.to === query.to &&
  isQueryResultSettled(queryResult)
    ? queryResult.availability
    : null;

/** A date query's availability once it has settled for that date, else null. */
const getSettledDateAvailability = (
  date: string,
  query: CoworkAvailabilityQuery,
  queryResult: AvailabilityQueryResult
) =>
  date &&
  query?.date === date &&
  queryResult.availability?.date === date &&
  isQueryResultSettled(queryResult)
    ? queryResult.availability
    : null;

/**
 * Whether a date can't be booked for the tier. A Reserved Desk stays
 * bookable on a date that needs a workstation, which the form then adds.
 */
const isCoworkDateUnavailable = (
  availability: WorkspaceAvailability,
  date: string,
  entryTier: CoworkReservationInput["entryTier"]
) =>
  availability.unavailableDates.includes(date) &&
  !(
    entryTier === "reserved-desk" &&
    availability.reservedDeskWorkstationRequiredDates.includes(date)
  );

/** The calendar dates the tier can't be booked on in the settled range. */
export const getCoworkCalendarUnavailableDates = (
  rangeAvailability: WorkspaceAvailability | null,
  entryTier: CoworkReservationInput["entryTier"]
) =>
  new Set(
    rangeAvailability?.unavailableDates.filter((date) =>
      isCoworkDateUnavailable(rangeAvailability, date, entryTier)
    )
  );

/**
 * Whether the selected day requires a Reserved Desk workstation, and the
 * monitor option the form adds when it does.
 */
export const getCoworkWorkstationRequirement = ({
  requirementAvailability,
  selection: { date, entryTier, monitorOption },
  unavailableMonitorOptions,
}: {
  readonly requirementAvailability: WorkspaceAvailability | null;
  readonly selection: CoworkAvailabilitySelection;
  readonly unavailableMonitorOptions: ReadonlySet<WorkspaceProductMonitorOption>;
}) => {
  const firstAvailableMonitorOption = getAllowedMonitorOptionsForCoworkTier(
    entryTier
  ).find((option) => !unavailableMonitorOptions.has(option));
  const isRequired = Boolean(
    entryTier === "reserved-desk" &&
      date &&
      requirementAvailability?.reservedDeskWorkstationRequiredDates.includes(
        date
      ) &&
      firstAvailableMonitorOption
  );

  return {
    firstAvailableMonitorOption,
    isRequired,
    /** The form has yet to add or replace the required workstation. */
    isNormalizationPending:
      isRequired &&
      (!monitorOption || unavailableMonitorOptions.has(monitorOption)),
  };
};

/** Whether the settled availability rules out the selected offer. */
export const isCoworkSelectionUnavailable = ({
  availability,
  selection: { date, entryTier, monitorOption },
  unavailableMonitorOptions,
}: {
  readonly availability: WorkspaceAvailability | null;
  readonly selection: CoworkAvailabilitySelection;
  readonly unavailableMonitorOptions: ReadonlySet<WorkspaceProductMonitorOption>;
}) =>
  Boolean(availability?.unavailableCoworkTiers.includes(entryTier)) ||
  Boolean(monitorOption && unavailableMonitorOptions.has(monitorOption)) ||
  Boolean(
    availability &&
      date &&
      isCoworkDateUnavailable(availability, date, entryTier)
  );

/**
 * Whether a selection query failed to settle once nothing is loading any
 * more, so availability can't be confirmed.
 */
export const isCoworkAvailabilityUnconfirmed = ({
  date,
  isPending,
  queries,
  selectionAvailability,
  requirementAvailability,
}: {
  readonly date: string;
  readonly isPending: boolean;
  readonly queries: ReturnType<typeof getCoworkAvailabilityQueries>;
  readonly selectionAvailability: WorkspaceAvailability | null;
  readonly requirementAvailability: WorkspaceAvailability | null;
}) => {
  const isSelectionUnsettled = Boolean(
    date && queries.selection?.date === date && !selectionAvailability
  );
  const isRequirementUnsettled = Boolean(
    queries.workstationRequirement && !requirementAvailability
  );
  return (isSelectionUnsettled || isRequirementUnsettled) && !isPending;
};

/** The message that blocks checkout for the selection, if any. */
const getCoworkSelectionUnavailableMessage = ({
  isUnavailable,
  isUnconfirmed,
  locale,
  selection: { date, entryTier },
}: {
  readonly isUnavailable: boolean;
  readonly isUnconfirmed: boolean;
  readonly locale: Locale;
  readonly selection: CoworkAvailabilitySelection;
}) => {
  if (isUnavailable) {
    return getReservationAvailabilityUnavailableMessage({
      date,
      dateFallback: m.reservationDatePlaceholder({}, { locale }),
      locale,
      reservation: { kind: "cowork", entryTier },
    });
  }
  return isUnconfirmed
    ? m.reservationAvailabilityError({}, { locale })
    : undefined;
};

/**
 * The cowork form's availability: the selected tier's calendar range, the
 * selected offer on its day, and whether a Reserved Desk needs a workstation
 * that day. Only a response settled for the current selection counts.
 */
export const useCoworkSelectionAvailability = ({
  initialAvailability,
  locale,
  replacementToken,
  selection,
  today,
}: {
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly selection: CoworkAvailabilitySelection;
  readonly today: string;
}) => {
  const { date, entryTier, monitorOption } = selection;
  const queries = useMemo(
    () =>
      getCoworkAvailabilityQueries({ date, entryTier, monitorOption, today }),
    [date, entryTier, monitorOption, today]
  );
  const queryOptions = { initialAvailability, replacementToken };
  const selectionQueryResult = useReservationAvailability(
    queries.selection,
    queryOptions
  );
  const rangeQueryResult = useReservationAvailability(
    queries.range,
    queryOptions
  );
  const requirementQueryResult = useReservationAvailability(
    queries.workstationRequirement,
    queryOptions
  );
  const rangeAvailability = getSettledRangeAvailability(
    queries.range,
    rangeQueryResult
  );
  const selectionAvailability = getSettledDateAvailability(
    date,
    queries.selection,
    selectionQueryResult
  );
  const requirementAvailability = getSettledDateAvailability(
    date,
    queries.workstationRequirement,
    requirementQueryResult
  );
  // Memoized because the workstation normalization effect depends on it.
  const unavailableMonitorOptions = useMemo(
    () => new Set(requirementAvailability?.unavailableMonitorOptions),
    [requirementAvailability]
  );
  const workstationRequirement = getCoworkWorkstationRequirement({
    requirementAvailability,
    selection,
    unavailableMonitorOptions,
  });
  const isSelectionPending =
    selectionQueryResult.isPending || requirementQueryResult.isPending;

  return {
    checkoutAvailability: {
      isPending:
        isSelectionPending ||
        rangeQueryResult.isPending ||
        workstationRequirement.isNormalizationPending,
      unavailableMessage: getCoworkSelectionUnavailableMessage({
        isUnavailable: isCoworkSelectionUnavailable({
          availability: selectionAvailability,
          selection,
          unavailableMonitorOptions,
        }),
        isUnconfirmed: isCoworkAvailabilityUnconfirmed({
          date,
          isPending: isSelectionPending,
          queries,
          requirementAvailability,
          selectionAvailability,
        }),
        locale,
        selection,
      }),
    },
    firstAvailableMonitorOption:
      workstationRequirement.firstAvailableMonitorOption,
    isSelectionSettled: selectionAvailability !== null,
    isWorkstationRequired: workstationRequirement.isRequired,
    isWorkstationRequirementSettled: requirementAvailability !== null,
    selectedDateNotices:
      selectionAvailability?.notices.filter((notice) => notice.date === date) ??
      [],
    unavailableCalendarDates: getCoworkCalendarUnavailableDates(
      rangeAvailability,
      entryTier
    ),
    unavailableCoworkTiers: new Set(
      (selectionAvailability ?? rangeAvailability)?.unavailableCoworkTiers
    ),
    unavailableMonitorOptions,
  };
};
