import type { DotyposTable, DotyposTableId } from "@deskohub/dotypos";
import { Match, Result } from "effect";
import {
  decodeTableCandidates,
  getOccupancyWindow,
  getTableBookingOccupancyById,
  getWorkspaceTableCandidates,
  getWorkspaceTableCandidatesByPredicate,
  hasCandidateCapacity,
  type InvalidDotyposTableSeats,
  isWorkspaceCoworkTableCandidate,
  type WorkspaceCoworkTableCandidateQuery,
  type WorkspaceTableCandidate,
  workspaceBookingSeatCount,
  workspaceMeetingRoomReservationTableTag,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation";
import type {
  OccupancyWindow,
  TableBooking,
} from "@/features/checkout/backend/reservation/workspace-table-occupancy";
import {
  isWorkspaceCoworkCurrentProductTier,
  type WorkspaceCoworkProductTier,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import {
  type MovablePassDay,
  planPassDayMove,
} from "@/features/passes/backend/pass-day-move-plan";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import {
  type CoworkStay,
  isOvernightCoworkStay,
} from "@/features/reservation/cowork-stay";
import {
  coworkReservationKind,
  officeReservationKind,
} from "@/features/reservation/reservation-kind";
import {
  isCoworkReservationInterval,
  isSingleDayReservationInterval,
  type ReservationInterval,
} from "../reservation-interval";
import type {
  WorkspaceAvailability,
  WorkspaceAvailabilityQuery,
} from "../workspace-availability";

export type AvailabilityEvaluationInput = {
  readonly query: WorkspaceAvailabilityQuery;
  /** Every date in the queried range, as `YYYY-MM-DD`. */
  readonly dates: readonly string[];
  readonly reservation: ReservationInterval | undefined;
  readonly selectedDate: string | undefined;
  readonly tables: readonly DotyposTable[];
  readonly bookings: readonly TableBooking[];
  readonly fullyOccupiedDates: ReadonlySet<string>;
  readonly movablePassDays?: readonly MovablePassDay[];
};

export type AvailabilityEvaluation = Pick<
  WorkspaceAvailability,
  | "unavailableDates"
  | "reservedDeskWorkstationRequiredDates"
  | "unavailableCoworkTiers"
  | "meetingRoomUnavailable"
  | "officeUnavailable"
  | "unavailableMonitorOptions"
>;

type Occupancy = {
  readonly byTableId: ReadonlyMap<DotyposTableId, number>;
  readonly window?: OccupancyWindow;
};

/**
 * Evaluates table availability for a date range synchronously. Each offer's
 * interval, occupancy, and candidate set is computed once per request and
 * reused across dates and checks.
 *
 * Fails with the first invalid seat capacity among the candidate sets the
 * evaluation touches, in evaluation order.
 */
export const evaluateAvailability = (
  input: AvailabilityEvaluationInput
): Result.Result<AvailabilityEvaluation, InvalidDotyposTableSeats> => {
  const coworkStay =
    input.query.kind === coworkReservationKind ? input.query.stay : undefined;
  const inventory = createInventoryView(
    input.tables,
    input.bookings,
    coworkStay,
    input.movablePassDays
  );
  const getDateOccupancy = createDateOccupancyLookup(inventory, input);
  const isOfferClosed = createOfferClosureLookup(input, coworkStay);

  // Alternative tier, monitor-option, and bare range-selection checks each use
  // the candidate offer's OWN authoritative interval; the selected offer's
  // interval must not leak into them (a 00:00-17:00 Open Space occupancy and a
  // full-day Reserved Desk occupancy describe different intervals).
  const reservedDeskWorkstationRequiredDates =
    input.query.kind === coworkReservationKind
      ? findReservedDeskWorkstationRequiredDates(
          inventory,
          input,
          isOfferClosed
        )
      : [];
  const unavailableDates = findUnavailableDates(
    inventory,
    input,
    getDateOccupancy,
    isOfferClosed
  );
  const selectedDateAvailability = input.selectedDate
    ? evaluateSelectedDate(
        inventory,
        input,
        input.selectedDate,
        getDateOccupancy,
        isOfferClosed
      )
    : noSelectedDateAvailability();

  return inventory.seatCapacityError
    ? Result.fail(inventory.seatCapacityError)
    : Result.succeed({
        unavailableDates,
        reservedDeskWorkstationRequiredDates,
        ...selectedDateAvailability,
      });
};

type SelectedDateAvailability = Pick<
  AvailabilityEvaluation,
  | "unavailableCoworkTiers"
  | "meetingRoomUnavailable"
  | "officeUnavailable"
  | "unavailableMonitorOptions"
>;

const noSelectedDateAvailability = (): SelectedDateAvailability => ({
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
});

type DateOccupancyLookup = (date: string) => Occupancy;

/** Whether a fully occupied Calendar date closes an offer arriving on `date`. */
type OfferClosureLookup = (
  date: string,
  tier: WorkspaceCoworkProductTier | undefined
) => boolean;

/**
 * A fully occupied Calendar date closes every offer on it. An overnight
 * Reserved Desk stay also touches the next date, so a fully occupied next
 * date closes it too.
 */
const createOfferClosureLookup = (
  { fullyOccupiedDates }: AvailabilityEvaluationInput,
  coworkStay: CoworkStay | undefined
): OfferClosureLookup => {
  return (date, tier) =>
    fullyOccupiedDates.has(date) ||
    (isOvernightCoworkStay(tier, coworkStay) &&
      fullyOccupiedDates.has(
        Temporal.PlainDate.from(date).add({ days: 1 }).toString()
      ));
};

/**
 * The selected date of a meeting-room or cowork query uses the selected
 * reservation's own interval; every other date uses the queried cowork
 * offer's canonical interval.
 */
const createDateOccupancyLookup = (
  inventory: InventoryView,
  { query, reservation, selectedDate }: AvailabilityEvaluationInput
): DateOccupancyLookup => {
  const entryTier =
    query.kind === coworkReservationKind ? query.entryTier : undefined;
  return (date) =>
    query.kind !== officeReservationKind && reservation && date === selectedDate
      ? inventory.getOccupancy(reservation)
      : inventory.getCoworkOfferOccupancy(date, entryTier);
};

/**
 * Dates on which a bare Reserved Desk is gone but at least one workstation
 * configuration is still open.
 */
const findReservedDeskWorkstationRequiredDates = (
  inventory: InventoryView,
  { dates }: AvailabilityEvaluationInput,
  isOfferClosed: OfferClosureLookup
) => {
  const workstationRequiredDates: string[] = [];
  for (const date of dates) {
    if (isOfferClosed(date, "reserved-desk")) continue;

    const reservedDeskOccupancy = inventory.getCoworkOfferOccupancy(
      date,
      "reserved-desk"
    );
    const bareReservedDeskUnavailable = isCoworkOfferUnavailable(
      inventory,
      reservedDeskOccupancy,
      { entryTier: "reserved-desk" }
    );
    if (!bareReservedDeskUnavailable) continue;

    const unavailableMonitorOptions = workspaceProductMonitorOptions.map(
      (monitorOption) =>
        isCoworkOfferUnavailable(inventory, reservedDeskOccupancy, {
          entryTier: "reserved-desk",
          monitorOption,
        })
    );
    if (unavailableMonitorOptions.some((unavailable) => !unavailable)) {
      workstationRequiredDates.push(date);
    }
  }
  return workstationRequiredDates;
};

/**
 * A range query checks every date unless its selected reservation interval
 * belongs to one date; then only the selected date is checked.
 */
const shouldCheckRangeDateSelection = ({
  query,
  reservation,
}: AvailabilityEvaluationInput) =>
  query.kind === officeReservationKind ||
  !reservation ||
  (query.kind === coworkReservationKind
    ? isCoworkReservationInterval(reservation)
    : isSingleDayReservationInterval(reservation));

const findUnavailableDates = (
  inventory: InventoryView,
  input: AvailabilityEvaluationInput,
  getDateOccupancy: DateOccupancyLookup,
  isOfferClosed: OfferClosureLookup
) => {
  const { query, dates, selectedDate } = input;
  const checksEveryDate = shouldCheckRangeDateSelection(input);
  const entryTier =
    query.kind === coworkReservationKind ? query.entryTier : undefined;
  const unavailableDates: string[] = [];
  for (const date of dates) {
    if (isOfferClosed(date, entryTier)) {
      unavailableDates.push(date);
      continue;
    }
    if (!(checksEveryDate || date === selectedDate)) continue;
    if (
      isUnavailableForSelection(
        inventory,
        getDateOccupancy(date),
        query,
        (tier) => inventory.getCoworkOfferOccupancy(date, tier)
      )
    ) {
      unavailableDates.push(date);
    }
  }
  return unavailableDates;
};

const evaluateSelectedDate = (
  inventory: InventoryView,
  {
    query,
    dates,
    reservation,
    fullyOccupiedDates,
  }: AvailabilityEvaluationInput,
  selectedDate: string,
  getDateOccupancy: DateOccupancyLookup,
  isOfferClosed: OfferClosureLookup
): SelectedDateAvailability => {
  const selectedDateOccupancy: Occupancy = dates.includes(selectedDate)
    ? getDateOccupancy(selectedDate)
    : { byTableId: new Map<DotyposTableId, number>() };
  // A fully occupied Calendar day closes every tier, whatever the tables say.
  const unavailableCoworkTiers = fullyOccupiedDates.has(selectedDate)
    ? [...workspaceCoworkCurrentTiers]
    : workspaceCoworkCurrentTiers.filter(
        (tier) =>
          isOfferClosed(selectedDate, tier) ||
          isCoworkCategoryUnavailable(
            inventory,
            inventory.getCoworkOfferOccupancy(selectedDate, tier),
            tier
          )
      );
  const meetingRoomUnavailable = isMeetingRoomUnavailable(
    inventory,
    selectedDateOccupancy
  );
  const officeUnavailable =
    query.kind === officeReservationKind &&
    isOfficeUnavailable(
      inventory,
      reservation ? inventory.getOccupancy(reservation) : selectedDateOccupancy,
      query.seats ?? workspaceBookingSeatCount
    );
  const unavailableMonitorOptions = workspaceProductMonitorOptions.filter(
    (monitorOption) =>
      isCoworkOfferUnavailable(
        inventory,
        inventory.getCoworkOfferOccupancy(selectedDate, "reserved-desk"),
        { entryTier: "reserved-desk", monitorOption }
      )
  );
  return {
    unavailableCoworkTiers,
    meetingRoomUnavailable,
    officeUnavailable,
    unavailableMonitorOptions,
  };
};

/**
 * Whether a meeting room is free for an interval, given the Prague dates the
 * interval touches. Fails with the first invalid meeting-room seat capacity.
 */
export type MeetingRoomIntervalEvaluator = (
  interval: ReservationInterval,
  touchedDates: { readonly from: string; readonly to: string }
) => Result.Result<boolean, InvalidDotyposTableSeats>;

/**
 * Evaluates meeting-room intervals against one inventory snapshot, as a
 * single-interval availability check for each would: taken when any date it
 * touches is fully occupied in the Calendar, else free while a meeting room
 * has capacity over the interval's own occupancy. Occupancy and candidates
 * are computed once per request and reused across intervals.
 */
export const createMeetingRoomIntervalEvaluator = ({
  tables,
  bookings,
  fullyOccupiedDates,
  movablePassDays = [],
}: Pick<
  AvailabilityEvaluationInput,
  "tables" | "bookings" | "fullyOccupiedDates" | "movablePassDays"
>): MeetingRoomIntervalEvaluator => {
  // Capacity reads only meeting-room tables' occupancy, so other tables'
  // bookings need not be scanned for each interval.
  const meetingRoomTableIds = new Set(
    getWorkspaceTableCandidates(tables, [
      workspaceMeetingRoomReservationTableTag,
    ]).map(({ id }) => id)
  );
  const movableRoomBookings = movablePassDays.filter(({ booking }) =>
    meetingRoomTableIds.has(booking.tableId)
  );
  const inventory = createInventoryView(
    tables,
    movableRoomBookings.length > 0
      ? bookings
      : bookings.filter(({ tableId }) => meetingRoomTableIds.has(tableId)),
    undefined,
    movableRoomBookings
  );
  const closedDates = [...fullyOccupiedDates];

  return (interval, { from, to }) => {
    const touchesClosedDate = closedDates.some(
      (date) => date >= from && date <= to
    );
    const roomUnavailable = isMeetingRoomUnavailable(
      inventory,
      inventory.getOccupancy(interval)
    );
    const free = !(touchesClosedDate || roomUnavailable);
    return inventory.seatCapacityError
      ? Result.fail(inventory.seatCapacityError)
      : Result.succeed(free);
  };
};

type InventoryView = ReturnType<typeof createInventoryView>;

/**
 * Request-local memoized view of one inventory snapshot. Candidate sets are
 * decoded lazily so an invalid table only fails the queries that would
 * consider it; the first such failure is kept and evaluation continues.
 */
const createInventoryView = (
  tables: readonly DotyposTable[],
  bookings: readonly TableBooking[],
  /** The queried Reserved Desk stay; other tiers ignore it. */
  coworkStay: CoworkStay | undefined,
  movablePassDays: readonly MovablePassDay[] = []
) => {
  const occupancyByInterval = new Map<string, Occupancy>();
  const coworkIntervals = new Map<string, ReservationInterval>();
  const candidatesByKey = new Map<string, readonly WorkspaceTableCandidate[]>();
  let seatCapacityError: InvalidDotyposTableSeats | undefined;

  const getOccupancy = (interval: ReservationInterval) => {
    const key = `${interval.startsAt}/${interval.endsAt}`;
    const cached = occupancyByInterval.get(key);
    if (cached) return cached;

    const window = getOccupancyWindow(interval);
    const occupancy = {
      window,
      byTableId: getTableBookingOccupancyById(bookings, window),
    };
    occupancyByInterval.set(key, occupancy);
    return occupancy;
  };

  const getCoworkOfferOccupancy = (
    date: string,
    tier: WorkspaceCoworkProductTier | undefined
  ) => {
    const key = `${date}/${tier ?? ""}`;
    let interval = coworkIntervals.get(key);
    if (!interval) {
      interval = getCoworkReservationInterval(tier, date, coworkStay);
      coworkIntervals.set(key, interval);
    }
    return getOccupancy(interval);
  };

  const getCandidates = (
    key: string,
    selectTables: () => readonly DotyposTable[]
  ) => {
    const cached = candidatesByKey.get(key);
    if (cached) return cached;

    const decoded = decodeTableCandidates(selectTables());
    const candidates = Result.isSuccess(decoded) ? decoded.success : [];
    if (Result.isFailure(decoded)) seatCapacityError ??= decoded.failure;
    candidatesByKey.set(key, candidates);
    return candidates;
  };

  return {
    getOccupancy,
    getCoworkOfferOccupancy,
    hasCapacity: (
      candidates: readonly WorkspaceTableCandidate[],
      { byTableId, window }: Occupancy,
      seats = workspaceBookingSeatCount,
      requireEmpty = false
    ) =>
      hasCandidateCapacity(candidates, byTableId, seats, requireEmpty) ||
      (window !== undefined &&
        planPassDayMove({
          sources: movablePassDays,
          bookings,
          tables,
          candidates,
          window,
          occupancy: byTableId,
          seats,
          requireEmpty,
        }) !== undefined),
    getCoworkOfferCandidates: (query: WorkspaceCoworkTableCandidateQuery) =>
      getCandidates(
        `cowork/${query.entryTier}/${query.monitorOption ?? ""}`,
        () =>
          getWorkspaceTableCandidatesByPredicate(tables, (tableTags) =>
            isWorkspaceCoworkTableCandidate(tableTags, query)
          )
      ),
    getTaggedCandidates: (requiredTags: readonly string[]) =>
      getCandidates(`tags/${requiredTags.join("/")}`, () =>
        getWorkspaceTableCandidates(tables, requiredTags)
      ),
    get seatCapacityError() {
      return seatCapacityError;
    },
  };
};

const isUnavailableForSelection = (
  inventory: InventoryView,
  occupancy: Occupancy,
  query: WorkspaceAvailabilityQuery,
  getCoworkOfferOccupancy: (tier: WorkspaceCoworkProductTier) => Occupancy
) =>
  Match.value(query).pipe(
    Match.discriminatorsExhaustive("kind")({
      "meeting-room": () => isMeetingRoomUnavailable(inventory, occupancy),
      cowork: (coworkQuery) =>
        isCoworkUnavailableForSelection(
          inventory,
          occupancy,
          coworkQuery,
          getCoworkOfferOccupancy
        ),
      office: ({ seats }) =>
        isOfficeUnavailable(
          inventory,
          occupancy,
          seats ?? workspaceBookingSeatCount
        ),
    })
  );

const isCoworkUnavailableForSelection = (
  inventory: InventoryView,
  occupancy: Occupancy,
  query: Extract<WorkspaceAvailabilityQuery, { readonly kind: "cowork" }>,
  getOfferOccupancy: (tier: WorkspaceCoworkProductTier) => Occupancy
) => {
  const { entryTier, monitorOption } = query;

  // A bare query offers every current category, so each category is judged
  // with its OWN authoritative interval occupancy (Open Space 00:00-17:00;
  // Reserved Desk full Prague day, including every eligible workstation
  // configuration). The date is unavailable only when no category has an
  // open offer — never because one category's interval looks full.
  if (!entryTier) {
    return workspaceCoworkCurrentTiers
      .map((candidateTier) =>
        isCoworkCategoryUnavailable(
          inventory,
          getOfferOccupancy(candidateTier),
          candidateTier
        )
      )
      .every(Boolean);
  }

  // Legacy tiers are only ever re-checked on historical recovery paths and
  // keep their `tier:${tier}` tags; they never serve a new current request.
  if (!isWorkspaceCoworkCurrentProductTier(entryTier)) {
    return !hasCandidateCapacity(
      inventory.getTaggedCandidates([
        `tier:${entryTier}`,
        ...(entryTier === "profi" && monitorOption
          ? workspaceProductMonitorOptionTableTags[monitorOption]
          : []),
      ]),
      occupancy.byTableId
    );
  }

  return isCoworkOfferUnavailable(inventory, occupancy, {
    entryTier,
    ...(monitorOption && { monitorOption }),
  });
};

/**
 * Availability uses the exact same shared candidate predicate as the
 * authoritative table assignment.
 */
const isCoworkOfferUnavailable = (
  inventory: InventoryView,
  occupancy: Occupancy,
  query: WorkspaceCoworkTableCandidateQuery
) =>
  !inventory.hasCapacity(inventory.getCoworkOfferCandidates(query), occupancy);

/**
 * A cowork category is offered when ANY eligible table for it is available in
 * that offer's true interval. Open Space only has bare open-space tables;
 * Reserved Desk remains available while either a bare desk or any single
 * workstation configuration is available in the full Prague day.
 */
const isCoworkCategoryUnavailable = (
  inventory: InventoryView,
  occupancy: Occupancy,
  entryTier: WorkspaceCoworkProductTier
) => {
  if (entryTier === "open-space") {
    return isCoworkOfferUnavailable(inventory, occupancy, { entryTier });
  }

  const bareUnavailable = isCoworkOfferUnavailable(inventory, occupancy, {
    entryTier,
  });
  const monitorOptionsUnavailable = workspaceProductMonitorOptions.map(
    (monitorOption) =>
      isCoworkOfferUnavailable(inventory, occupancy, {
        entryTier,
        monitorOption,
      })
  );
  return bareUnavailable && monitorOptionsUnavailable.every(Boolean);
};

const isMeetingRoomUnavailable = (
  inventory: InventoryView,
  occupancy: Occupancy
) =>
  !inventory.hasCapacity(
    inventory.getTaggedCandidates([workspaceMeetingRoomReservationTableTag]),
    occupancy,
    workspaceBookingSeatCount,
    true
  );

const isOfficeUnavailable = (
  inventory: InventoryView,
  occupancy: Occupancy,
  seats: number
) =>
  !inventory.hasCapacity(
    inventory.getTaggedCandidates([workspaceOfficeReservationTableTag]),
    occupancy,
    seats,
    true
  );
