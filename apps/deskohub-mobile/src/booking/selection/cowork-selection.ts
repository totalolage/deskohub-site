import type {
  CustomerAvailability,
  CustomerBookableCoworkTier,
  CustomerBookingSelection,
  CustomerMonitorOption,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Array as Arr, Data, Option } from "effect";
import type { AvailabilityQuery, DateChoice } from "./booking-selection";
import { addMonths, type PragueDate, pragueDateTimeAt } from "./prague-date";

/**
 * Where a Reserved Desk's workstation came from: the customer chose it, or
 * the screen added it because the date has no bare desk left. Only an added
 * one is removed again when the date stops requiring it.
 */
export type CoworkWorkstationOrigin = "customer" | "requirement";

/** A cowork booking the customer is putting together. */
export type CoworkDraft = {
  readonly tier: CustomerBookableCoworkTier;
  readonly date: PragueDate;
  /** Open Space only; a Reserved Desk includes coffee. */
  readonly coffee: boolean;
  /** Reserved Desk only: the monitor workstation. */
  readonly workstation: Option.Option<{
    readonly option: CustomerMonitorOption;
    readonly origin: CoworkWorkstationOrigin;
  }>;
};

type CoworkOffering = Extract<CustomerOffering, { readonly family: "cowork" }>;

// Bookable from 00:00 to 17:00 Prague time; same-day booking ends with it.
const openSpaceClosingHour = 17;
const horizonMonths = 6;

const coworkOfferings = (offerings: ReadonlyArray<CustomerOffering>) =>
  offerings.filter(
    (offering): offering is CoworkOffering => offering.family === "cowork"
  );

/**
 * The draft a cowork screen opens with: Open Space today without coffee,
 * or the first cowork tier offered when Open Space isn't.
 */
export const defaultCoworkDraft = (
  today: PragueDate,
  offerings: ReadonlyArray<CustomerOffering>
): CoworkDraft => {
  const tiers = coworkOfferings(offerings).map((offering) => offering.tier);
  return {
    tier: tiers.includes("open-space")
      ? "open-space"
      : (tiers[0] ?? "open-space"),
    date: today,
    coffee: false,
    workstation: Option.none(),
  };
};

/** The draft with another tier; Open Space drops the workstation. */
export const selectCoworkTier = (
  draft: CoworkDraft,
  tier: CustomerBookableCoworkTier
): CoworkDraft => ({
  ...draft,
  tier,
  workstation: tier === "reserved-desk" ? draft.workstation : Option.none(),
});

/** The draft with the customer's own workstation choice, or none. */
export const selectCoworkWorkstation = (
  draft: CoworkDraft,
  option: Option.Option<CustomerMonitorOption>
): CoworkDraft => ({
  ...draft,
  workstation: Option.map(option, (chosen) => ({
    option: chosen,
    origin: "customer" as const,
  })),
});

/** The booking the draft names, as the quote and checkout take it. */
export const toCoworkSelection = (
  draft: CoworkDraft
): CustomerBookingSelection => ({
  family: "cowork",
  date: draft.date,
  tier: draft.tier,
  ...(draft.tier === "open-space"
    ? { coffee: draft.coffee }
    : Option.match(draft.workstation, {
        onNone: () => ({}),
        onSome: ({ option }) => ({ monitorOption: option }),
      })),
});

/** The availability queries a cowork screen reads for its draft. */
export type CoworkAvailabilityQueries = {
  /** The tier's six-month calendar. */
  readonly range: AvailabilityQuery;
  /** The drafted offer on its date alone. */
  readonly selection: AvailabilityQuery;
  /** Reserved Desk only: whether the date needs a workstation. */
  readonly workstationRequirement: Option.Option<AvailabilityQuery>;
};

/** The calendar a cowork draft may pick from: today through six months. */
const coworkDateRange = (today: PragueDate) => ({
  earliest: today,
  latest: addMonths(today, horizonMonths),
});

export const coworkAvailabilityQueries = (
  draft: CoworkDraft,
  today: PragueDate
): CoworkAvailabilityQueries => {
  const { earliest, latest } = coworkDateRange(today);
  const selectedDate: AvailabilityQuery = {
    kind: "cowork",
    from: draft.date,
    to: draft.date,
    entryTier: draft.tier,
    date: draft.date,
  };
  const isReservedDesk = draft.tier === "reserved-desk";
  return {
    range: {
      kind: "cowork",
      from: earliest,
      to: latest,
      entryTier: draft.tier,
    },
    selection: Option.match(
      Option.filter(draft.workstation, () => isReservedDesk),
      {
        onNone: () => selectedDate,
        onSome: ({ option }) => ({ ...selectedDate, monitorOption: option }),
      }
    ),
    workstationRequirement: isReservedDesk
      ? Option.some(selectedDate)
      : Option.none(),
  };
};

/**
 * Availability settled for the current `coworkAvailabilityQueries`; none
 * while a query is loading.
 */
export type CoworkAvailability = {
  readonly range: Option.Option<CustomerAvailability>;
  readonly selection: Option.Option<CustomerAvailability>;
  readonly workstationRequirement: Option.Option<CustomerAvailability>;
};

/** Why a cowork draft can't continue to checkout. */
export type CoworkBlocker = Data.TaggedEnum<{
  /** A query the draft needs hasn't settled. */
  AvailabilityPending: Record<never, never>;
  DateOutOfRange: Record<never, never>;
  /** Same-day Open Space can't be booked from 17:00 Prague time. */
  OpenSpaceClosedToday: Record<never, never>;
  /** The tier is taken or not offered on the date. */
  OfferUnavailable: Record<never, never>;
  /** The chosen workstation is taken on the date. */
  WorkstationUnavailable: Record<never, never>;
  /** The date has no bare desk left and no workstation is free either. */
  WorkstationRequired: Record<never, never>;
}>;
export const CoworkBlocker = Data.taggedEnum<CoworkBlocker>();

/** What a cowork screen offers and disables for its draft. */
export type CoworkEnablement = {
  readonly dates: DateChoice;
  /** Tiers taken on the date, or across the calendar before it settles. */
  readonly unavailableTiers: ReadonlySet<string>;
  /** Whether Open Space can no longer be booked for today. */
  readonly openSpaceClosedToday: boolean;
  /** The Reserved Desk workstation configurations, in catalog order. */
  readonly workstations: ReadonlyArray<{
    readonly id: CustomerMonitorOption;
    readonly name: string;
  }>;
  readonly unavailableWorkstations: ReadonlySet<CustomerMonitorOption>;
  /**
   * The workstation a Reserved Desk takes when its date has no bare desk
   * left: the first free one. None when the date doesn't require one, or
   * when every workstation is taken.
   */
  readonly requiredWorkstation: Option.Option<CustomerMonitorOption>;
  /** Whether the date has no bare desk left, so a workstation is required. */
  readonly workstationRequired: boolean;
  /** The selected date's Calendar limitations. */
  readonly notices: CustomerAvailability["notices"];
  readonly blockers: ReadonlyArray<CoworkBlocker>;
};

/**
 * Whether a cowork offer can be booked on its date: a Reserved Desk stays
 * bookable on a date that only requires a workstation.
 */
const isOfferAvailable = (
  availability: CustomerAvailability,
  draft: Pick<CoworkDraft, "date" | "tier">
) =>
  !(
    availability.unavailableCoworkTiers.includes(draft.tier) ||
    (availability.unavailableDates.includes(draft.date) &&
      !(
        draft.tier === "reserved-desk" &&
        availability.reservedDeskWorkstationRequiredDates.includes(draft.date)
      ))
  );

const isOpenSpaceClosedToday = (now: Date) =>
  pragueDateTimeAt(now).hour >= openSpaceClosingHour;

export const coworkEnablement = (
  draft: CoworkDraft,
  context: {
    readonly now: Date;
    readonly offerings: ReadonlyArray<CustomerOffering>;
    readonly availability: CoworkAvailability;
  }
): CoworkEnablement => {
  const { range, selection, workstationRequirement } = context.availability;
  const today = pragueDateTimeAt(context.now).date;
  const { earliest, latest } = coworkDateRange(today);
  const isReservedDesk = draft.tier === "reserved-desk";

  const workstations = Arr.findFirst(
    coworkOfferings(context.offerings),
    (offering) => offering.tier === "reserved-desk"
  ).pipe(
    Option.flatMap((offering) =>
      Arr.findFirst(offering.addOns, (addOn) => addOn.id === "workstation")
    ),
    Option.flatMap((addOn) => Option.fromNullishOr(addOn.options)),
    Option.getOrElse(() => [])
  );
  const unavailableWorkstations = new Set(
    Option.match(workstationRequirement, {
      onNone: () => [],
      onSome: (availability) => availability.unavailableMonitorOptions,
    })
  );
  const workstationRequired =
    isReservedDesk &&
    Option.exists(workstationRequirement, (availability) =>
      availability.reservedDeskWorkstationRequiredDates.includes(draft.date)
    );
  const requiredWorkstation = workstationRequired
    ? Arr.findFirst(
        workstations,
        ({ id }) => !unavailableWorkstations.has(id)
      ).pipe(Option.map(({ id }) => id))
    : Option.none();

  const openSpaceClosedToday = isOpenSpaceClosedToday(context.now);
  const chosenWorkstation = Option.map(
    Option.filter(draft.workstation, () => isReservedDesk),
    ({ option }) => option
  );

  const blockers: Array<CoworkBlocker> = [];
  if (
    Option.isNone(range) ||
    Option.isNone(selection) ||
    (isReservedDesk && Option.isNone(workstationRequirement))
  ) {
    blockers.push(CoworkBlocker.AvailabilityPending());
  }
  if (draft.date < earliest || draft.date > latest) {
    blockers.push(CoworkBlocker.DateOutOfRange());
  }
  if (
    draft.tier === "open-space" &&
    draft.date === today &&
    openSpaceClosedToday
  ) {
    blockers.push(CoworkBlocker.OpenSpaceClosedToday());
  }
  if (
    Option.exists(
      selection,
      (availability) => !isOfferAvailable(availability, draft)
    )
  ) {
    blockers.push(CoworkBlocker.OfferUnavailable());
  }
  if (
    Option.exists(chosenWorkstation, (id) => unavailableWorkstations.has(id))
  ) {
    blockers.push(CoworkBlocker.WorkstationUnavailable());
  } else if (workstationRequired && Option.isNone(chosenWorkstation)) {
    blockers.push(CoworkBlocker.WorkstationRequired());
  }

  return {
    dates: {
      earliest,
      latest,
      unavailable: new Set(
        Option.match(range, {
          onNone: () => [],
          onSome: (availability) =>
            availability.unavailableDates.filter(
              (date) =>
                !isOfferAvailable(availability, { date, tier: draft.tier })
            ),
        })
      ),
    },
    unavailableTiers: new Set(
      Option.orElse(selection, () => range).pipe(
        Option.match({
          onNone: () => [],
          onSome: (availability) => availability.unavailableCoworkTiers,
        })
      )
    ),
    openSpaceClosedToday,
    workstations,
    unavailableWorkstations,
    requiredWorkstation,
    workstationRequired,
    notices: Option.match(selection, {
      onNone: () => [],
      onSome: (availability) =>
        availability.notices.filter((notice) => notice.date === draft.date),
    }),
    blockers,
  };
};

/**
 * The draft with its Reserved Desk workstation fitted to settled
 * availability: a date that requires a workstation adds the first free one,
 * or replaces a taken choice keeping its origin. Once the date stops
 * requiring one, only a workstation the screen added is removed; the
 * customer's own choice stays. Unchanged until the date's queries settle.
 */
export const normalizeCoworkWorkstation = (
  draft: CoworkDraft,
  availability: CoworkAvailability,
  enablement: CoworkEnablement
): CoworkDraft => {
  const settled =
    draft.tier === "reserved-desk" &&
    Option.isSome(availability.selection) &&
    Option.isSome(availability.workstationRequirement);
  if (!settled) return draft;

  return Option.match(enablement.requiredWorkstation, {
    onSome: (required) =>
      Option.match(draft.workstation, {
        onNone: () => ({
          ...draft,
          workstation: Option.some({
            option: required,
            origin: "requirement" as const,
          }),
        }),
        onSome: (current) =>
          enablement.unavailableWorkstations.has(current.option)
            ? {
                ...draft,
                workstation: Option.some({ ...current, option: required }),
              }
            : draft,
      }),
    onNone: () =>
      Option.exists(draft.workstation, ({ origin }) => origin === "requirement")
        ? { ...draft, workstation: Option.none() }
        : draft,
  });
};
