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
        "Meeting room only: Prague start time in HH:mm on the hour, such as 09:00. Not used for the whole-day booking.",
    }).check(Schema.isPattern(/^\d{2}:\d{2}$/))
  ),
  duration: Schema.optionalKey(
    meetingRoomReservationDurationKeySchema.annotate({
      description:
        "Meeting room only: hour:1 (one hour), hour:4 (four hours), or day:1 (the whole Prague calendar day).",
    })
  ),
  seats: Schema.optionalKey(
    Schema.Int.annotate({
      description: "Office only: number of seats. Defaults to 1.",
    }).check(Schema.isGreaterThanOrEqualTo(1))
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
  function* ({
    date,
    endDate = date,
    today,
  }: {
    readonly date: string;
    readonly endDate?: string;
    readonly today: Temporal.PlainDate;
  }) {
    yield* ensureDateOrder({ date, endDate });
    const range = getWorkspaceAvailabilityRange(today.toString());
    yield* ensureWithin({ dates: [date, endDate], ...range });
    const dates = getPlainDatesBetween(
      Temporal.PlainDate.from(date),
      Temporal.PlainDate.from(endDate)
    );
    if (dates.length > coworkMaximumDayCount) {
      return yield* AgentToolError.dateOutOfRange({
        earliest: date,
        latest: Temporal.PlainDate.from(date)
          .add({ days: coworkMaximumDayCount - 1 })
          .toString(),
      });
    }

    return dates.map((day) => day.toString());
  }
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
)(function* ({
  date,
  startTime,
  duration: durationKey,
  now,
}: {
  readonly date: string;
  readonly startTime?: string;
  readonly duration?: MeetingRoomReservationDurationKey;
  readonly now: Temporal.Instant;
}) {
  if (!durationKey) return yield* AgentToolError.invalidInput("duration");
  const duration = getMeetingRoomReservationDuration(durationKey);
  if (duration.unit === "hour" && !startTime) {
    return yield* AgentToolError.invalidInput("start_time");
  }

  const startDateTime = yield* Schema.decodeEffect(
    meetingRoomStartDateTimeSchema
  )(`${date}T${startTime ?? "00:00"}`).pipe(
    Effect.mapError(() => AgentToolError.invalidInput("start_time"))
  );
  const interval = getMeetingRoomReservationInterval(startDateTime, duration);
  if (!interval) return yield* AgentToolError.invalidInput("start_time");

  // A booking stays open while its end is ahead, so the earliest start can
  // lie before now; the form applies the same bound.
  const earliestStart = Temporal.PlainDateTime.from(
    getEarliestMeetingRoomStartDateTime(duration, now)
  );
  const range = getWorkspaceAvailabilityRange(
    getCurrentWorkspaceDate(now).toString()
  );
  const startsBeforeEarliest =
    Temporal.PlainDateTime.compare(
      Temporal.PlainDateTime.from(startDateTime),
      earliestStart
    ) < 0;
  if (startsBeforeEarliest || date > range.to) {
    return yield* AgentToolError.dateOutOfRange({
      earliest: earliestStart.toPlainDate().toString(),
      latest: range.to,
    });
  }

  return { durationKey, duration, startDateTime, interval };
});

/** An office date range inside the booking horizon and the duration limit. */
export const resolveOfficeRange = Effect.fn("agentTools.resolveOfficeRange")(
  function* ({
    date,
    endDate = date,
    today,
  }: {
    readonly date: PlainDate;
    readonly endDate?: PlainDate;
    readonly today: Temporal.PlainDate;
  }) {
    yield* ensureDateOrder({ date, endDate });
    const maximumEndsOn = getOfficeReservationMaximumEndsOn(today);
    yield* ensureWithin({
      dates: [date],
      from: today.toString(),
      to: maximumEndsOn.toString(),
    });
    const maximumDayCount = getOfficeReservationMaximumDayCount({
      startsOn: date,
      maximumEndsOn,
      unavailableDates: [],
    });
    const latest = Temporal.PlainDate.from(date)
      .add({ days: maximumDayCount - 1 })
      .toString();
    yield* ensureWithin({ dates: [endDate], from: date, to: latest });

    return {
      startsOn: date,
      endsOn: endDate,
      dates: getPlainDatesBetween(
        Temporal.PlainDate.from(date),
        Temporal.PlainDate.from(endDate)
      ).map((day) => day.toString()),
    };
  }
);

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
