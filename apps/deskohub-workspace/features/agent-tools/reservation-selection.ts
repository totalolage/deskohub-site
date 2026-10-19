import { Effect, Schema } from "effect";
import {
  type WorkspaceCoworkCurrentTier,
  workspaceCoworkCurrentTiers,
} from "@/features/checkout/product-catalog";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { isCoworkOpenSpaceDayCutoffReached } from "@/features/reservation/cowork-reservation";
import { meetingRoomStartDateTimeSchema } from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDuration,
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDuration,
  type MeetingRoomReservationDurationKey,
  meetingRoomReservationDurationKeySchema,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  getOfficeReservationMaximumDayCount,
  getOfficeReservationMaximumEndsOn,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { hasReservationIntervalEnded } from "@/features/reservation/reservation-interval";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { getWorkspaceAvailabilityRange } from "@/features/reservation/workspace-availability";
import {
  getPlainDatesBetween,
  isPlainDateString,
  type PlainDate,
} from "@/shared/utils/temporal";
import { AgentToolError } from "./agent-tool-error";

/** The most days one cowork request covers. */
const coworkMaximumDayCount = 31;

// Tool arguments use inline schemas without identifiers, so each published
// property carries its own type and description instead of a shared `$ref`.
const workspaceDateArgument = (description: string) =>
  Schema.String.annotate({ description })
    .check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/), isPlainDateString())
    .pipe(Schema.brand("PlainDate"));

/** Selection fields shared by the availability and quote tools. */
export const reservationSelectionFields = {
  family: workspaceReservationKindSchema.annotate({
    description:
      "Reservation family: cowork (a desk for a day), meeting-room, or office (a private office for whole days).",
  }),
  date: workspaceDateArgument(
    "Prague calendar date in YYYY-MM-DD format. For an office or a cowork range, the first date."
  ),
  end_date: Schema.optionalKey(
    workspaceDateArgument(
      "Cowork or office only: the last date, inclusive, in YYYY-MM-DD format. Defaults to date."
    )
  ),
  start_time: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Meeting room only: Prague start time in HH:mm on the hour, such as 09:00; the booking must end after the current time (a booking already in progress is allowed). Not used for the whole-day booking.",
    }).check(Schema.isPattern(/^\d{2}:\d{2}$/))
  ),
  duration: Schema.optionalKey(
    meetingRoomReservationDurationKeySchema.annotate({
      description:
        "Meeting room only: hour:1 (one hour), hour:4 (four hours), or day:1 (a whole Prague calendar day, today included until it ends).",
    })
  ),
  seats: Schema.optionalKey(
    Schema.Int.annotate({
      description: "Office only: number of seats. Defaults to 1.",
    }).check(Schema.isGreaterThanOrEqualTo(1))
  ),
};

/**
 * The shared fields for a quote: a cowork booking covers one date, so only an
 * office takes a date range.
 */
export const quoteSelectionFields = {
  ...reservationSelectionFields,
  date: workspaceDateArgument(
    "Prague calendar date in YYYY-MM-DD format. For an office, the first date."
  ),
  end_date: Schema.optionalKey(
    workspaceDateArgument(
      "Office only: the last date, inclusive, in YYYY-MM-DD format. Defaults to date."
    )
  ),
};

/** Fails with `unsupported_family` while office reservations are closed. */
export const ensureOfficeOpen = OfficeReservationFeatureFlagService.pipe(
  Effect.flatMap((flag) => flag.isEnabled),
  Effect.filterOrFail(
    (enabled) => enabled,
    () => AgentToolError.unsupportedFamily()
  ),
  Effect.asVoid
);

/** The dates of a cowork request, inside the advisory calendar range. */
export const resolveCoworkDates = Effect.fn("agentTools.resolveCoworkDates")(
  ({
    date,
    endDate = date,
    today,
  }: {
    readonly date: string;
    readonly endDate?: string;
    readonly today: Temporal.PlainDate;
  }) =>
    Effect.Do.pipe(
      Effect.tap(() => ensureDateOrder({ date, endDate })),
      Effect.tap(() =>
        ensureWithin({
          dates: [date, endDate],
          ...getWorkspaceAvailabilityRange(today.toString()),
        })
      ),
      Effect.let("dates", () =>
        getPlainDatesBetween(
          Temporal.PlainDate.from(date),
          Temporal.PlainDate.from(endDate)
        )
      ),
      Effect.filterOrFail(
        ({ dates }) => dates.length <= coworkMaximumDayCount,
        () =>
          AgentToolError.dateOutOfRange({
            earliest: date,
            latest: Temporal.PlainDate.from(date)
              .add({ days: coworkMaximumDayCount - 1 })
              .toString(),
          })
      ),
      Effect.map(({ dates }) => dates.map((day) => day.toString()))
    )
);

/** Whether a cowork offer can still start on a date, given the time of day. */
export const isCoworkOfferOpen = (input: {
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly date: string;
  readonly now: Temporal.Instant;
}) => !isCoworkOpenSpaceDayCutoffReached(input);

/** The current cowork offers, or the one a request names. */
export const getRequestedCoworkTiers = (
  tier: WorkspaceCoworkCurrentTier | undefined
): ReadonlyArray<WorkspaceCoworkCurrentTier> =>
  tier ? [tier] : workspaceCoworkCurrentTiers;

/** A meeting-room selection resolved to its duration and Prague interval. */
export const resolveMeetingRoomSelection = Effect.fn(
  "agentTools.resolveMeetingRoomSelection"
)(
  (input: {
    readonly date: string;
    readonly startTime?: string;
    readonly duration?: MeetingRoomReservationDurationKey;
    readonly now: Temporal.Instant;
  }) =>
    Effect.Do.pipe(
      Effect.bind("durationKey", () =>
        requireArgument(input.duration, "duration")
      ),
      Effect.let("duration", ({ durationKey }) =>
        getMeetingRoomReservationDuration(durationKey)
      ),
      Effect.bind("startDateTime", ({ duration }) =>
        decodeMeetingRoomStart({ ...input, duration })
      ),
      Effect.bind("interval", ({ startDateTime, duration }) =>
        requireArgument(
          getMeetingRoomReservationInterval(startDateTime, duration),
          "start_time"
        )
      ),
      Effect.tap(({ duration, interval }) =>
        ensureMeetingRoomSelectionOpen({ ...input, duration, interval })
      ),
      Effect.map(({ durationKey, duration, startDateTime, interval }) => ({
        durationKey,
        duration,
        startDateTime,
        interval,
      }))
    )
);

/** An office date range inside the booking horizon and the duration limit. */
export const resolveOfficeRange = Effect.fn("agentTools.resolveOfficeRange")(
  ({
    date,
    endDate = date,
    today,
  }: {
    readonly date: PlainDate;
    readonly endDate?: PlainDate;
    readonly today: Temporal.PlainDate;
  }) =>
    Effect.Do.pipe(
      Effect.tap(() => ensureDateOrder({ date, endDate })),
      Effect.let("maximumEndsOn", () =>
        getOfficeReservationMaximumEndsOn(today)
      ),
      Effect.tap(({ maximumEndsOn }) =>
        ensureWithin({
          dates: [date],
          from: today.toString(),
          to: maximumEndsOn.toString(),
        })
      ),
      Effect.let("latest", ({ maximumEndsOn }) =>
        Temporal.PlainDate.from(date)
          .add({
            days:
              getOfficeReservationMaximumDayCount({
                startsOn: date,
                maximumEndsOn,
                unavailableDates: [],
              }) - 1,
          })
          .toString()
      ),
      Effect.tap(({ latest }) =>
        ensureWithin({ dates: [endDate], from: date, to: latest })
      ),
      Effect.map(() => ({
        startsOn: date,
        endsOn: endDate,
        dates: getPlainDatesBetween(
          Temporal.PlainDate.from(date),
          Temporal.PlainDate.from(endDate)
        ).map((day) => day.toString()),
      }))
    )
);

const requireArgument = <A>(value: A, field: string) =>
  Effect.fromNullishOr(value).pipe(
    Effect.mapError(() => AgentToolError.invalidInput(field))
  );

/**
 * The selected start; an hourly booking needs a start time, and a whole day
 * starts at midnight whatever time the call names.
 */
const decodeMeetingRoomStart = ({
  date,
  startTime,
  duration,
}: {
  readonly date: string;
  readonly startTime?: string;
  readonly duration: MeetingRoomReservationDuration;
}) =>
  Effect.succeed(
    isMeetingRoomWholeDayReservationDuration(duration) ? "00:00" : startTime
  ).pipe(
    Effect.filterOrFail(
      (time) => time !== undefined,
      () => AgentToolError.invalidInput("start_time")
    ),
    Effect.flatMap((time) =>
      Schema.decodeEffect(meetingRoomStartDateTimeSchema)(`${date}T${time}`)
    ),
    Effect.mapError(() => AgentToolError.invalidInput("start_time"))
  );

/**
 * Checkout and a reservation link keep a selection until its interval ends, so
 * the tool accepts the same selections and its link opens the form on them.
 */
const ensureMeetingRoomSelectionOpen = (input: {
  readonly date: string;
  readonly duration: MeetingRoomReservationDuration;
  readonly interval: ReservationInterval;
  readonly now: Temporal.Instant;
}) =>
  Effect.succeed(
    getWorkspaceAvailabilityRange(getCurrentWorkspaceDate(input.now).toString())
  ).pipe(
    Effect.filterOrFail(
      (range) =>
        !hasReservationIntervalEnded(input.interval, input.now) &&
        input.date <= range.to,
      (range) =>
        AgentToolError.dateOutOfRange({
          earliest: getFirstOpenMeetingRoomDate(input.duration, input.now),
          latest: range.to,
        })
    ),
    Effect.asVoid
  );

/** The Prague date of the first selection the tool accepts. */
const getFirstOpenMeetingRoomDate = (
  duration: MeetingRoomReservationDuration,
  now: Temporal.Instant
) =>
  Temporal.PlainDateTime.from(
    getEarliestMeetingRoomStartDateTime(duration, now)
  )
    .toPlainDate()
    .toString();

const ensureDateOrder = ({
  date,
  endDate,
}: {
  readonly date: string;
  readonly endDate: string;
}) =>
  Effect.succeed(endDate).pipe(
    Effect.filterOrFail(
      (end) => end >= date,
      () => AgentToolError.invalidInput("end_date")
    ),
    Effect.asVoid
  );

const ensureWithin = ({
  dates,
  from,
  to,
}: {
  readonly dates: ReadonlyArray<string>;
  readonly from: string;
  readonly to: string;
}) =>
  Effect.succeed(dates).pipe(
    Effect.filterOrFail(
      (candidates) => candidates.every((date) => date >= from && date <= to),
      () => AgentToolError.dateOutOfRange({ earliest: from, latest: to })
    ),
    Effect.asVoid
  );
