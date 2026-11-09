import type {
  CustomerAvailability,
  CustomerBookingSelection,
  CustomerMeetingRoomDuration,
  CustomerMeetingRoomStartTimes,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Array as Arr, Data, Option, Result } from "effect";
import {
  type AvailabilityQuery,
  type DateChoice,
  SelectionIncomplete,
} from "./booking-selection";
import { addMonths, type PragueDate, pragueToday } from "./prague-date";

/** A meeting-room booking the customer is putting together. */
export type MeetingRoomDraft = {
  readonly date: PragueDate;
  readonly duration: CustomerMeetingRoomDuration;
  /**
   * Prague start time, HH:mm, for the hourly durations; none until the
   * date's free starts load. A whole-day booking ignores it.
   */
  readonly startTime: Option.Option<string>;
  /** The room opens 15 minutes early for setup, at no cost. */
  readonly earlySetup: boolean;
};

/** One free start the screen offers for the draft's date and duration. */
export type MeetingRoomStart =
  CustomerMeetingRoomStartTimes["startTimes"][number];

type MeetingRoomOffering = Extract<
  CustomerOffering,
  { readonly family: "meeting-room" }
>;

const defaultDuration: CustomerMeetingRoomDuration = "hour:1";
const horizonMonths = 6;

/**
 * The draft a meeting-room screen opens with: one hour today, start to be
 * filled in from the free starts, no early setup. Without a one-hour
 * offering, the first duration offered.
 */
export const defaultMeetingRoomDraft = (
  today: PragueDate,
  offerings: ReadonlyArray<CustomerOffering>
): MeetingRoomDraft => {
  const durations = offerings
    .filter(
      (offering): offering is MeetingRoomOffering =>
        offering.family === "meeting-room"
    )
    .map((offering) => offering.duration);
  return {
    date: today,
    duration: durations.includes(defaultDuration)
      ? defaultDuration
      : (durations[0] ?? defaultDuration),
    startTime: Option.none(),
    earlySetup: false,
  };
};

/**
 * The draft on another date. The chosen start time and early setup carry
 * over; the screen shows them taken, or drops early setup, once the new
 * date's free starts load.
 */
export const selectMeetingRoomDate = (
  draft: MeetingRoomDraft,
  date: PragueDate
): MeetingRoomDraft => ({ ...draft, date });

/** The draft with the customer's start time. */
export const selectMeetingRoomStartTime = (
  draft: MeetingRoomDraft,
  startTime: string
): MeetingRoomDraft => ({ ...draft, startTime: Option.some(startTime) });

const isWholeDay = (duration: CustomerMeetingRoomDuration) =>
  duration === "day:1";

/** HH:mm of a start's Prague local date-time, YYYY-MM-DDTHH:mm. */
const startTimeOf = (start: MeetingRoomStart) =>
  start.startDateTime.slice(11, 16);

/**
 * The booking the draft names. A whole day takes no start time; an hourly
 * booking is incomplete without one.
 */
export const toMeetingRoomSelection = (
  draft: MeetingRoomDraft
): Result.Result<CustomerBookingSelection, SelectionIncomplete> => {
  const base = {
    family: "meeting-room",
    date: draft.date,
    duration: draft.duration,
  } as const;
  if (isWholeDay(draft.duration)) return Result.succeed(base);
  return Option.match(draft.startTime, {
    onNone: () =>
      Result.fail(new SelectionIncomplete({ missing: ["startTime"] })),
    onSome: (startTime) => Result.succeed({ ...base, startTime }),
  });
};

/** The query for the free starts of the draft's date and duration. */
export const meetingRoomStartTimesQuery = (draft: MeetingRoomDraft) => ({
  date: draft.date,
  duration: draft.duration,
});

/** Whether free starts were loaded for the draft's date and duration. */
const startTimesFor = (
  draft: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>
) =>
  Option.filter(
    startTimes,
    (loaded) => loaded.date === draft.date && loaded.duration === draft.duration
  );

/** The loaded starts whose interval hasn't ended at `now`. */
const withoutEnded = (
  loaded: CustomerMeetingRoomStartTimes,
  now: Date
): CustomerMeetingRoomStartTimes => ({
  ...loaded,
  startTimes: loaded.startTimes.filter(
    (start) => new Date(start.endsAt).getTime() > now.getTime()
  ),
});

/** The free start the draft books, among starts loaded for it. */
const chosenStart = (
  draft: MeetingRoomDraft,
  startTimes: CustomerMeetingRoomStartTimes
): Option.Option<MeetingRoomStart> =>
  isWholeDay(draft.duration)
    ? Arr.head(startTimes.startTimes)
    : Option.flatMap(draft.startTime, (startTime) =>
        Arr.findFirst(
          startTimes.startTimes,
          (start) => startTimeOf(start) === startTime
        )
      );

/**
 * The availability query for the interval the draft books, built from its
 * free start: Prague dates from the start's day to the day the booking last
 * touches, and the interval's instants. None until the start is known.
 */
export const meetingRoomAvailabilityQuery = (
  draft: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>
): Option.Option<AvailabilityQuery> =>
  startTimesFor(draft, startTimes).pipe(
    Option.flatMap((loaded) => chosenStart(draft, loaded)),
    Option.map((start) => ({
      kind: "meeting-room",
      from: draft.date,
      // A booking ending at midnight doesn't touch the next day.
      to: pragueToday(new Date(new Date(start.endsAt).getTime() - 1)),
      startsAt: start.startsAt,
      endsAt: start.endsAt,
    }))
  );

/**
 * The draft fitted to the free starts loaded for it: an hourly draft without
 * a start takes the earliest one not yet ended at `now`, and early setup
 * clears unless the chosen start offers it. A chosen start no longer free is
 * kept, and the screen shows it taken. Starts loaded for another date or
 * duration change nothing.
 */
export const reconcileMeetingRoomDraft = (
  draft: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>,
  now: Date
): MeetingRoomDraft =>
  Option.match(
    Option.map(startTimesFor(draft, startTimes), (loaded) =>
      withoutEnded(loaded, now)
    ),
    {
      onNone: () => draft,
      onSome: (loaded) => {
        const withStart =
          isWholeDay(draft.duration) || Option.isSome(draft.startTime)
            ? draft
            : {
                ...draft,
                startTime: Arr.head(loaded.startTimes).pipe(
                  Option.map(startTimeOf)
                ),
              };
        const keepsEarlySetup = Option.exists(
          chosenStart(withStart, loaded),
          (start) => start.earlySetupAvailable
        );
        return withStart.earlySetup && !keepsEarlySetup
          ? { ...withStart, earlySetup: false }
          : withStart;
      },
    }
  );

/** Why a meeting-room draft can't continue to checkout. */
export type MeetingRoomBlocker = Data.TaggedEnum<{
  /** The free starts or the interval's availability haven't loaded. */
  AvailabilityPending: Record<never, never>;
  DateOutOfRange: Record<never, never>;
  /** An hourly draft has no start: the date has no free start left. */
  NoFreeStart: Record<never, never>;
  /** The chosen start, or the whole day, isn't free or has ended. */
  StartUnavailable: Record<never, never>;
}>;
export const MeetingRoomBlocker = Data.taggedEnum<MeetingRoomBlocker>();

/** What a meeting-room screen offers and disables for its draft. */
export type MeetingRoomEnablement = {
  readonly dates: DateChoice;
  /**
   * Free starts of the draft's date and duration not yet ended, in time
   * order.
   */
  readonly startTimes: ReadonlyArray<{
    readonly startTime: string;
    readonly earlySetupAvailable: boolean;
  }>;
  /** Whether the chosen start lets the room open early for setup. */
  readonly earlySetupAvailable: boolean;
  readonly notices: CustomerAvailability["notices"];
  readonly blockers: ReadonlyArray<MeetingRoomBlocker>;
};

export const meetingRoomEnablement = (
  draft: MeetingRoomDraft,
  context: {
    readonly now: Date;
    /** The latest free starts read, for any date and duration. */
    readonly startTimes: Option.Option<CustomerMeetingRoomStartTimes>;
    /** Availability settled for `meetingRoomAvailabilityQuery`. */
    readonly availability: Option.Option<CustomerAvailability>;
  }
): MeetingRoomEnablement => {
  const today = pragueToday(context.now);
  const latest = addMonths(today, horizonMonths);
  const loaded = Option.map(
    startTimesFor(draft, context.startTimes),
    (starts) => withoutEnded(starts, context.now)
  );
  const start = Option.flatMap(loaded, (starts) => chosenStart(draft, starts));
  const hasStart = isWholeDay(draft.duration) || Option.isSome(draft.startTime);

  const blockers: Array<MeetingRoomBlocker> = [];
  if (draft.date < today || draft.date > latest) {
    blockers.push(MeetingRoomBlocker.DateOutOfRange());
  }
  if (Option.isNone(loaded)) {
    blockers.push(MeetingRoomBlocker.AvailabilityPending());
  } else if (!hasStart) {
    blockers.push(MeetingRoomBlocker.NoFreeStart());
  } else if (Option.isNone(start)) {
    blockers.push(MeetingRoomBlocker.StartUnavailable());
  } else if (Option.isNone(context.availability)) {
    blockers.push(MeetingRoomBlocker.AvailabilityPending());
  } else if (context.availability.value.meetingRoomUnavailable) {
    blockers.push(MeetingRoomBlocker.StartUnavailable());
  }

  return {
    dates: { earliest: today, latest, unavailable: new Set() },
    startTimes: Option.match(loaded, {
      onNone: () => [],
      onSome: (starts) =>
        starts.startTimes.map((free) => ({
          startTime: startTimeOf(free),
          earlySetupAvailable: free.earlySetupAvailable,
        })),
    }),
    earlySetupAvailable: Option.exists(
      start,
      (free) => free.earlySetupAvailable
    ),
    notices: Option.match(context.availability, {
      onNone: () => [],
      onSome: (availability) => availability.notices,
    }),
    blockers,
  };
};
