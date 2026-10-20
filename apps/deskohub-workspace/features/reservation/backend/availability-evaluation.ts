import type {
  DotyposTable,
  DotyposTableId,
  ValidationError,
} from "@deskohub/dotypos";
import { Match, Result } from "effect";
import {
  decodeTableCandidates,
  getOccupancyWindow,
  getTableBookingOccupancyById,
  getWorkspaceTableCandidates,
  getWorkspaceTableCandidatesByPredicate,
  hasCandidateCapacity,
  isWorkspaceCoworkTableCandidate,
  toTableBookings,
  type WorkspaceCoworkTableCandidateQuery,
  type WorkspaceTableCandidate,
  workspaceBookingSeatCount,
  workspaceMeetingRoomReservationTableTag,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation";
import {
  isWorkspaceCoworkCurrentProductTier,
  type WorkspaceCoworkProductTier,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
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
import type { ReservationRecord } from "./reservation-record";

export type AvailabilityEvaluationInput = {
  readonly query: WorkspaceAvailabilityQuery;
  /** Every date in the queried range, as `YYYY-MM-DD`. */
  readonly dates: readonly string[];
  readonly reservation: ReservationInterval | undefined;
  readonly selectedDate: string | undefined;
  readonly tables: readonly DotyposTable[];
  readonly reservations: readonly ReservationRecord[];
  readonly fullyOccupiedDates: ReadonlySet<string>;
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

type Occupancy = ReadonlyMap<DotyposTableId, number>;

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
): Result.Result<AvailabilityEvaluation, ValidationError> => {
  const { query, dates, reservation, selectedDate, fullyOccupiedDates } = input;
  const inventory = createInventoryView(input.tables, input.reservations);
  const shouldCheckRangeDateSelection =
    query.kind === officeReservationKind ||
    !reservation ||
    (query.kind === coworkReservationKind
      ? isCoworkReservationInterval(reservation)
      : isSingleDayReservationInterval(reservation));
  const getDateOccupancy = (date: string) =>
    query.kind !== officeReservationKind && reservation && date === selectedDate
      ? inventory.getOccupancy(reservation)
      : inventory.getCoworkOfferOccupancy(
          date,
          query.kind === coworkReservationKind ? query.entryTier : undefined
        );

  // Alternative tier, monitor-option, and bare range-selection checks each use
  // the candidate offer's OWN authoritative interval; the selected offer's
  // interval must not leak into them (a 00:00-17:00 Open Space occupancy and a
  // full-day Reserved Desk occupancy describe different intervals).
  const reservedDeskWorkstationRequiredDates: string[] = [];
  if (query.kind === coworkReservationKind) {
    for (const date of dates) {
      if (fullyOccupiedDates.has(date)) continue;

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
        reservedDeskWorkstationRequiredDates.push(date);
      }
    }
  }

  const unavailableDates: string[] = [];
  for (const date of dates) {
    if (fullyOccupiedDates.has(date)) {
      unavailableDates.push(date);
      continue;
    }
    if (!(shouldCheckRangeDateSelection || date === selectedDate)) continue;
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

  const selectedDateOccupancy: Occupancy =
    selectedDate && dates.includes(selectedDate)
      ? getDateOccupancy(selectedDate)
      : new Map();
  const unavailableCoworkTiers = selectedDate
    ? workspaceCoworkCurrentTiers.filter((tier) =>
        isCoworkCategoryUnavailable(
          inventory,
          inventory.getCoworkOfferOccupancy(selectedDate, tier),
          tier
        )
      )
    : [];
  const meetingRoomUnavailable = selectedDate
    ? isMeetingRoomUnavailable(inventory, selectedDateOccupancy)
    : false;
  const officeUnavailable =
    query.kind === officeReservationKind && selectedDate
      ? isOfficeUnavailable(
          inventory,
          reservation
            ? inventory.getOccupancy(reservation)
            : selectedDateOccupancy,
          query.seats ?? workspaceBookingSeatCount
        )
      : false;
  const unavailableMonitorOptions = selectedDate
    ? workspaceProductMonitorOptions.filter((monitorOption) =>
        isCoworkOfferUnavailable(
          inventory,
          inventory.getCoworkOfferOccupancy(selectedDate, "reserved-desk"),
          { entryTier: "reserved-desk", monitorOption }
        )
      )
    : [];

  return inventory.seatCapacityError
    ? Result.fail(inventory.seatCapacityError)
    : Result.succeed({
        unavailableDates,
        reservedDeskWorkstationRequiredDates,
        unavailableCoworkTiers,
        meetingRoomUnavailable,
        officeUnavailable,
        unavailableMonitorOptions,
      });
};

type InventoryView = ReturnType<typeof createInventoryView>;

/**
 * Request-local memoized view of one inventory snapshot. Candidate sets are
 * decoded lazily so an invalid table only fails the queries that would
 * consider it; the first such failure is kept and evaluation continues.
 */
const createInventoryView = (
  tables: readonly DotyposTable[],
  reservations: readonly ReservationRecord[]
) => {
  const bookings = toTableBookings(reservations);
  const occupancyByInterval = new Map<string, Occupancy>();
  const coworkIntervals = new Map<string, ReservationInterval>();
  const candidatesByKey = new Map<string, readonly WorkspaceTableCandidate[]>();
  let seatCapacityError: ValidationError | undefined;

  const getOccupancy = (interval: ReservationInterval) => {
    const key = `${interval.startsAt}/${interval.endsAt}`;
    const cached = occupancyByInterval.get(key);
    if (cached) return cached;

    const occupancy = getTableBookingOccupancyById(
      bookings,
      getOccupancyWindow(interval)
    );
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
      interval = getCoworkReservationInterval(tier, date);
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
      occupancy
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
  !hasCandidateCapacity(inventory.getCoworkOfferCandidates(query), occupancy);

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
  !hasCandidateCapacity(
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
  !hasCandidateCapacity(
    inventory.getTaggedCandidates([workspaceOfficeReservationTableTag]),
    occupancy,
    seats,
    true
  );
