import type { WorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import type { CoworkReservationInput } from "@/features/reservation/cowork-reservation";
import {
  getAllowedMonitorOptionsForCoworkTier,
  type WorkspaceCoworkAvailabilityTarget,
} from "@/features/reservation/cowork-reservation-product";
import {
  isCoworkOfferAvailable,
  type WorkspaceAvailabilityState,
} from "@/features/reservation/workspace-availability";

/**
 * How the selected workstation got there: the form added it because the
 * selected date requires one, the customer chose it, or there is none.
 */
export type CoworkWorkstationOrigin =
  | "auto-added"
  | "customer-selected"
  | "none";

/** The origin of the selected workstation, given whether the form added it. */
export const getCoworkWorkstationOrigin = ({
  autoAdded,
  monitorOption,
}: Pick<CoworkReservationInput, "monitorOption"> & {
  readonly autoAdded: boolean;
}): CoworkWorkstationOrigin => {
  if (autoAdded) return "auto-added";
  return monitorOption ? "customer-selected" : "none";
};

type CoworkAvailabilitySelection = Pick<
  CoworkReservationInput,
  "date" | "entryTier" | "monitorOption"
>;

type CoworkAvailabilityQueries = {
  /** The selected tier's calendar range. */
  readonly range: WorkspaceAvailabilityState;
  /** The selected offer on the selected date. */
  readonly selection: WorkspaceAvailabilityState;
  /** Whether a Reserved Desk needs a workstation on the selected date. */
  readonly workstationRequirement: WorkspaceAvailabilityState;
};

/** The selected date's monitor options and the workstation it requires. */
const evaluateCoworkWorkstation = (
  { selection, workstationRequirement }: CoworkAvailabilityQueries,
  { date, entryTier, monitorOption }: CoworkAvailabilitySelection
) => {
  const requirementAvailability = workstationRequirement.availability;
  const unavailableMonitorOptions: ReadonlySet<WorkspaceProductMonitorOption> =
    new Set(requirementAvailability?.unavailableMonitorOptions ?? []);
  const firstAvailableMonitorOption = getAllowedMonitorOptionsForCoworkTier(
    entryTier
  ).find((option) => !unavailableMonitorOptions.has(option));
  const isReservedDesk = entryTier === "reserved-desk";

  return {
    /** Whether the selected date's monitor options settled. */
    settled: requirementAvailability !== null,
    unavailableMonitorOptions,
    /**
     * The monitor option a Reserved Desk takes when the selected date has
     * no bare desk left, so it needs a workstation.
     */
    requiredMonitorOption:
      isReservedDesk &&
      date &&
      requirementAvailability?.reservedDeskWorkstationRequiredDates.includes(
        date
      )
        ? firstAvailableMonitorOption
        : undefined,
    isSelectedMonitorUnavailable: Boolean(
      monitorOption && unavailableMonitorOptions.has(monitorOption)
    ),
    /**
     * Whether both selected-date queries settled for a Reserved Desk, so
     * the form may normalize the workstation to them.
     */
    normalizable:
      isReservedDesk &&
      selection.availability !== null &&
      requirementAvailability !== null,
  };
};

/** The dates, tiers, and notices the selected tier's calendar shows. */
const evaluateCoworkCalendar = (
  { range, selection }: CoworkAvailabilityQueries,
  { date, entryTier }: CoworkAvailabilitySelection
) => {
  const rangeAvailability = range.availability;
  const selectedAvailability = selection.availability;

  return {
    /**
     * Calendar dates the selected tier can't be booked on. A Reserved Desk
     * keeps dates that only require a workstation selectable.
     */
    unavailableDates: new Set(
      rangeAvailability
        ? rangeAvailability.unavailableDates.filter(
            (unavailableDate) =>
              !isCoworkOfferAvailable(rangeAvailability, {
                date: unavailableDate,
                entryTier,
              })
          )
        : []
    ),
    /** Tiers unavailable on the selected date, else across the range. */
    unavailableTiers: new Set(
      (selectedAvailability ?? rangeAvailability)?.unavailableCoworkTiers ?? []
    ),
    /** Partial availability notices for the selected date. */
    selectedDateNotices: (selectedAvailability?.notices ?? []).filter(
      (notice) => notice.date === date
    ),
  };
};

/** Whether the selected date's availability rules out the selected offer. */
const isSelectedCoworkOfferUnavailable = (
  selectedAvailability: WorkspaceAvailabilityState["availability"],
  { date, entryTier }: CoworkAvailabilitySelection
) =>
  Boolean(
    selectedAvailability &&
      date &&
      !isCoworkOfferAvailable(selectedAvailability, { date, entryTier })
  );

/** Whether checkout waits on the queries, or on adding a workstation. */
const isCoworkCheckoutPending = (
  { range, selection, workstationRequirement }: CoworkAvailabilityQueries,
  workstation: ReturnType<typeof evaluateCoworkWorkstation>,
  monitorOption: CoworkAvailabilitySelection["monitorOption"]
) =>
  selection.isPending ||
  workstationRequirement.isPending ||
  range.isPending ||
  Boolean(
    workstation.requiredMonitorOption &&
      (!monitorOption || workstation.isSelectedMonitorUnavailable)
  );

/** The checkout state the availability leaves for the selected offer. */
const evaluateCoworkCheckout = (
  queries: CoworkAvailabilityQueries,
  workstation: ReturnType<typeof evaluateCoworkWorkstation>,
  current: CoworkAvailabilitySelection
) => {
  const { selection, workstationRequirement } = queries;
  const isSelectedOfferUnavailable =
    isSelectedCoworkOfferUnavailable(selection.availability, current) ||
    workstation.isSelectedMonitorUnavailable;

  return {
    isPending: isCoworkCheckoutPending(
      queries,
      workstation,
      current.monitorOption
    ),
    isError:
      (selection.isError || workstationRequirement.isError) &&
      !(selection.isPending || workstationRequirement.isPending),
    unavailable: isSelectedOfferUnavailable
      ? ({
          kind: "cowork",
          entryTier: current.entryTier,
        } satisfies WorkspaceCoworkAvailabilityTarget)
      : undefined,
  };
};

/**
 * What the availability of a cowork form's queries (see
 * `getCoworkAvailabilityQueries`) allows for the current selection. Each
 * query's availability counts only once it settled for the current query.
 */
export const evaluateCoworkSelectionAvailability = (
  queries: CoworkAvailabilityQueries,
  current: CoworkAvailabilitySelection
) => {
  const workstation = evaluateCoworkWorkstation(queries, current);

  return {
    ...evaluateCoworkCalendar(queries, current),
    workstation,
    checkout: evaluateCoworkCheckout(queries, workstation, current),
  };
};

type CoworkWorkstationAvailability = ReturnType<
  typeof evaluateCoworkSelectionAvailability
>["workstation"];

/**
 * The workstation a settled Reserved Desk selection switches to, or
 * `undefined` to keep it. A date that requires a workstation adds the first
 * available one, or replaces an unavailable choice and keeps its origin. Once
 * the date stops requiring one, only a workstation the form added itself is
 * removed; the customer's own choice stays.
 */
export const getCoworkWorkstationNormalization = (
  workstation: Pick<
    CoworkWorkstationAvailability,
    "isSelectedMonitorUnavailable" | "normalizable" | "requiredMonitorOption"
  >,
  current: Pick<CoworkAvailabilitySelection, "monitorOption"> & {
    readonly origin: CoworkWorkstationOrigin;
  }
):
  | {
      readonly monitorOption?: WorkspaceProductMonitorOption;
      readonly origin: CoworkWorkstationOrigin;
    }
  | undefined => {
  if (!workstation.normalizable) return undefined;

  const { requiredMonitorOption } = workstation;
  if (requiredMonitorOption) {
    if (!current.monitorOption) {
      return { monitorOption: requiredMonitorOption, origin: "auto-added" };
    }
    return workstation.isSelectedMonitorUnavailable
      ? { monitorOption: requiredMonitorOption, origin: current.origin }
      : undefined;
  }

  return current.origin === "auto-added"
    ? { monitorOption: undefined, origin: "none" }
    : undefined;
};
